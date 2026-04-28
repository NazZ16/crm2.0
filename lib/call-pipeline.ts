// lib/call-pipeline.ts
// Lógica de pipeline partilhada entre /api/calls/upload e /api/share-target.
//
// Persistência completa (replica /api/agents/leads/route.ts):
//   - leads (full_name, phone, email, score, urgency, last_contact_at)
//   - lead_profiles (deep merge dos 6 blocos + summary + confidence_score)
//   - agent_extractions (extracted_json, recommendations_json, drafts_json)
//   - agent_runs (status, tokens, duration)
//   - interactions (transcript completo + summary)
//   - tasks (a partir de next_best_actions; fallback follow-up se urgência alta)

import { transcribeAudio } from '@/lib/whisper'
import { leadAgent } from '@/lib/agents/lead-agent'
import { callCoachAgent } from '@/lib/agents/call-coach-agent'
import { createServiceClient } from '@/lib/supabase/server'
import { normalizePhone } from '@/lib/phone'
import type { LeadProfile, AgentFullOutput } from '@/lib/types'

export async function runCallPipeline(
  uploadId: string,
  teamId: string,
  audioBuffer: Buffer,
  filename: string,
  userId: string
): Promise<void> {
  const supabase = createServiceClient()

  try {
    // Passo a: Transcrição
    const { text: transcriptText, duration_s } = await transcribeAudio(audioBuffer, filename)

    await supabase
      .from('call_uploads')
      .update({
        transcript_text: transcriptText,
        audio_duration_s: duration_s,
        whisper_model: 'whisper-1',
        status: 'analyzing',
        updated_at: new Date().toISOString(),
      })
      .eq('id', uploadId)

    // Para chamadas longas (>10 min ≈ >8000 chars), usar apenas início + fim
    const MAX_CHARS = 12000
    const analysisText =
      transcriptText.length > MAX_CHARS
        ? transcriptText.slice(0, MAX_CHARS * 0.7) +
          '\n\n[...transcrição resumida...]\n\n' +
          transcriptText.slice(-MAX_CHARS * 0.3)
        : transcriptText

    // Passo b: Carregar agent_learnings (context-aware extraction)
    const { data: learningsData } = await supabase
      .from('agent_learnings')
      .select('content')
      .eq('team_id', teamId)
      .order('confidence', { ascending: false })
      .limit(5)
    const agentLearnings = (learningsData ?? []).map((l: { content: string }) => l.content)

    // Passo c: Criar agent_run para tracking
    const { data: run } = await supabase
      .from('agent_runs')
      .insert({
        team_id: teamId,
        agent_type: 'lead',
        trigger_type: 'n8n_webhook',
        lead_id: null, // ainda não temos lead_id
        input_summary: `Análise de chamada: ${filename}`,
        status: 'running',
      })
      .select('id')
      .single()

    // Passo d: Lead agent — extrair TUDO
    const startMs = Date.now()
    let agentOutput: AgentFullOutput

    try {
      agentOutput = await leadAgent.analyze({
        leadName: 'Lead (chamada)',
        conversationText: analysisText,
        objective:
          'Extrair nome completo, telefone, email, score, urgência e perfil da lead a partir desta chamada.',
        agentLearnings,
      })
    } catch (err) {
      if (run) {
        await supabase
          .from('agent_runs')
          .update({
            status: 'failed',
            error: err instanceof Error ? err.message : String(err),
            duration_ms: Date.now() - startMs,
          })
          .eq('id', run.id)
      }
      throw err
    }

    const durationMs = Date.now() - startMs
    const meta = (agentOutput as AgentFullOutput & { _meta?: { tokens?: number } })._meta
    delete (agentOutput as AgentFullOutput & { _meta?: unknown })._meta

    const ex = agentOutput.lead_updates
    const extractedPhone = normalizePhone(ex.phone ?? undefined)
    const extractedFullName =
      ex.full_name && ex.full_name.trim().length > 0 ? ex.full_name.trim() : null
    const extractedEmail =
      ex.email && ex.email.trim().length > 0 ? ex.email.trim() : null
    const extractedScore = ex.score ?? null
    const extractedUrgency = ex.urgency ?? null

    // Passo e: Dedup por telefone
    let leadId: string | null = null
    let existingLeadName: string | null = null

    if (extractedPhone) {
      const { data: existingLead } = await supabase
        .from('leads')
        .select('id, full_name')
        .eq('team_id', teamId)
        .eq('phone', extractedPhone)
        .maybeSingle()

      if (existingLead) {
        leadId = existingLead.id
        existingLeadName = existingLead.full_name ?? null

        // Atualiza lead. Só sobrepõe full_name se o atual é placeholder.
        const isPlaceholder =
          !existingLeadName ||
          existingLeadName === 'Lead (chamada)' ||
          existingLeadName.toLowerCase().includes('lead ')

        const leadUpdate: Record<string, unknown> = {
          score: extractedScore,
          urgency: extractedUrgency,
          last_contact_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }
        if (extractedFullName && isPlaceholder) leadUpdate.full_name = extractedFullName
        if (extractedEmail) leadUpdate.email = extractedEmail

        await supabase.from('leads').update(leadUpdate).eq('id', leadId)
      }
    }

    if (!leadId) {
      const { data: newLead } = await supabase
        .from('leads')
        .insert({
          team_id: teamId,
          assigned_to: userId,
          full_name: extractedFullName ?? 'Lead (chamada)',
          phone: extractedPhone,
          email: extractedEmail,
          status: 'new',
          source: 'call_upload',
          score: extractedScore,
          urgency: extractedUrgency,
        })
        .select('id')
        .single()

      if (newLead) {
        leadId = newLead.id
      }
    }

    if (!leadId) throw new Error('Falhou a criar ou encontrar lead')

    // Passo f: Carregar profile existente para merge
    const { data: existingProfile } = (await supabase
      .from('lead_profiles')
      .select('*')
      .eq('lead_id', leadId)
      .maybeSingle()) as { data: LeadProfile | null }

    // Deep merge: só sobrepõe valores não-null/não-vazios
    function mergeField<T>(
      existing: T | null | undefined,
      updated: Partial<T> | null | undefined
    ): T | null {
      if (!updated) return existing ?? null
      if (!existing) return updated as T
      const result = { ...existing } as Record<string, unknown>
      for (const [k, v] of Object.entries(updated as Record<string, unknown>)) {
        if (v !== null && v !== undefined) {
          if (Array.isArray(v) && v.length > 0) result[k] = v
          else if (!Array.isArray(v)) result[k] = v
        }
      }
      return result as T
    }

    const now = new Date().toISOString()

    // Passo g: Upsert lead_profiles com TODOS os blocos
    await supabase.from('lead_profiles').upsert(
      {
        lead_id: leadId,
        home_preferences: mergeField(existingProfile?.home_preferences, ex.home_preferences),
        financial_profile: mergeField(existingProfile?.financial_profile, ex.financial_profile),
        personality_traits: mergeField(
          existingProfile?.personality_traits,
          ex.personality_traits
        ),
        family_context: mergeField(existingProfile?.family_context, ex.family_context),
        fears_objections: mergeField(existingProfile?.fears_objections, ex.fears_objections),
        process_preferences: mergeField(
          existingProfile?.process_preferences,
          ex.process_preferences
        ),
        summary: ex.summary || existingProfile?.summary || null,
        confidence_score: ex.confidence_score,
        updated_at: now,
      },
      { onConflict: 'lead_id' }
    )

    // Passo h: agent_extractions (raw output completo)
    await supabase.from('agent_extractions').insert({
      team_id: teamId,
      lead_id: leadId,
      upload_id: uploadId,
      run_id: run?.id ?? null,
      extracted_json: agentOutput.lead_updates,
      recommendations_json: agentOutput.recommendations,
      drafts_json: agentOutput.drafts,
    })

    // Passo i: Atualizar agent_run com lead_id + tokens
    if (run) {
      await supabase
        .from('agent_runs')
        .update({
          lead_id: leadId,
          status: 'done',
          output_json: agentOutput,
          tokens_used: meta?.tokens ?? null,
          duration_ms: durationMs,
        })
        .eq('id', run.id)
    }

    // Passo j: Coach feedback
    const { data: recentInteractions } = await supabase
      .from('interactions')
      .select('summary')
      .eq('lead_id', leadId)
      .eq('team_id', teamId)
      .not('summary', 'is', null)
      .order('occurred_at', { ascending: false })
      .limit(3)

    const summaries = (recentInteractions ?? [])
      .map((i: { summary: string | null }) => i.summary)
      .filter((s): s is string => s !== null)

    const coachFeedback = await callCoachAgent.analyze(
      analysisText,
      extractedFullName ?? existingLeadName ?? 'Lead (chamada)',
      summaries
    )

    // Passo k: Registar interação (transcript completo + summary do agent)
    const interactionSummary = [
      ex.summary,
      `Sentimento: ${coachFeedback.sentimento_lead}`,
    ]
      .filter(Boolean)
      .join(' | ')

    await supabase.from('interactions').insert({
      lead_id: leadId,
      team_id: teamId,
      type: 'call',
      raw_text: transcriptText,
      summary: interactionSummary,
      occurred_at: now,
    })

    // Passo l: Tasks a partir de next_best_actions (até 3) + fallback follow-up se urgência >= 3
    const actions = agentOutput.recommendations.next_best_actions ?? []
    let tasksCreated = 0

    if (actions.length > 0) {
      const priorityMap: Record<string, 'low' | 'medium' | 'high' | 'urgent'> = {
        high: 'high',
        medium: 'medium',
        low: 'low',
      }

      const tasksToCreate = actions.slice(0, 3).map((action) => ({
        lead_id: leadId,
        team_id: teamId,
        assigned_to: userId,
        title: action.title,
        description: action.description,
        priority: priorityMap[action.priority] ?? 'medium',
        created_by: 'agent' as const,
        due_at: action.due_in_hours
          ? new Date(Date.now() + action.due_in_hours * 60 * 60 * 1000).toISOString()
          : null,
        status: 'open' as const,
      }))

      const { data: insertedTasks } = await supabase
        .from('tasks')
        .insert(tasksToCreate)
        .select('id')
      tasksCreated = insertedTasks?.length ?? 0
    }

    // Fallback: se o agent não devolveu actions e urgência for elevada, gerar follow-up sequence
    if (tasksCreated === 0 && extractedUrgency != null && extractedUrgency >= 3) {
      await createFollowUpSequence(supabase, teamId, leadId, userId)
    }

    // Passo m: Marcar upload como done
    await supabase
      .from('call_uploads')
      .update({
        lead_id: leadId,
        coach_feedback: coachFeedback as unknown as Record<string, unknown>,
        status: 'done',
        processed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', uploadId)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await supabase
      .from('call_uploads')
      .update({
        status: 'failed',
        error: message,
        updated_at: new Date().toISOString(),
      })
      .eq('id', uploadId)
  }
}

async function createFollowUpSequence(
  supabase: ReturnType<typeof createServiceClient>,
  teamId: string,
  leadId: string,
  userId: string
): Promise<void> {
  const { data: existingTasks } = await supabase
    .from('tasks')
    .select('id')
    .eq('team_id', teamId)
    .eq('lead_id', leadId)
    .eq('status', 'open')
    .limit(1)

  if (existingTasks && existingTasks.length > 0) return

  const now = new Date()
  await supabase.from('tasks').insert([
    {
      team_id: teamId,
      lead_id: leadId,
      assigned_to: userId,
      title: 'Follow-up inicial — chamada recente',
      description: 'Contactar lead após chamada recebida. Urgência elevada.',
      due_at: new Date(now.getTime()).toISOString(),
      status: 'open',
      priority: 'urgent',
      created_by: 'agent',
    },
    {
      team_id: teamId,
      lead_id: leadId,
      assigned_to: userId,
      title: 'Follow-up 3 dias — verificar interesse',
      description: 'Verificar interesse da lead após contacto inicial.',
      due_at: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      status: 'open',
      priority: 'high',
      created_by: 'agent',
    },
    {
      team_id: teamId,
      lead_id: leadId,
      assigned_to: userId,
      title: 'Follow-up 7 dias — decisão final',
      description: 'Obter decisão final da lead ou reagendar.',
      due_at: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      status: 'open',
      priority: 'medium',
      created_by: 'agent',
    },
  ])
}
