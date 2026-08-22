// lib/call-pipeline.ts
// Logica de pipeline partilhada entre /api/calls/upload, /api/telegram/webhook,
// /api/ingest e /api/share-target.
//
// Persistencia:
//   - leads (identidade: full_name, phone, email — resolvida de imediato, precisa
//     de existir para a extraccao ficar associada a alguem)
//   - agent_extractions (fica 'pending' — perfil/score/urgencia/tasks so sao
//     aplicados quando o utilizador confirma em /dashboard/leads/[id], via
//     lib/apply-extraction.ts)
//   - agent_runs (status, tokens, duration)
//   - interactions (transcript completo + summary — historico, nao e uma decisao)
//   - notifications (avisa que ha uma extraccao pendente por rever)

import { transcribeAudio } from '@/lib/whisper'
import { leadAgent } from '@/lib/agents/lead-agent'
import { callCoachAgent } from '@/lib/agents/call-coach-agent'
import { diarizationAgent } from '@/lib/agents/diarization-agent'
import { createServiceClient } from '@/lib/supabase/server'
import { normalizePhone } from '@/lib/phone'
import type { AgentFullOutput } from '@/lib/types'
import type { SupabaseClient } from '@supabase/supabase-js'

export async function runCallPipeline(
  uploadId: string,
  teamId: string,
  audioBuffer: Buffer,
  filename: string,
  userId: string,
  known?: { knownContactName?: string; knownPhone?: string }
): Promise<void> {
  const supabase = createServiceClient()

  try {
    // Passo a: Transcricao (Whisper)
    const { text: transcriptText, duration_s, model: whisperModel } = await transcribeAudio(audioBuffer, filename)

    await supabase
      .from('call_uploads')
      .update({
        transcript_text: transcriptText,
        audio_duration_s: duration_s,
        whisper_model: whisperModel,
        status: 'analyzing',
        updated_at: new Date().toISOString(),
      })
      .eq('id', uploadId)

    await processTranscript(supabase, uploadId, teamId, transcriptText, filename, userId, known)
  } catch (err) {
    await marcarFalhado(supabase, uploadId, err)
  }
}

/**
 * Variante para transcricoes ja prontas (ex: Plaud, que transcreve no proprio
 * aparelho e expoe so o texto via Zapier - sem ficheiro de audio). Salta o
 * Whisper e entra directamente na analise/dedup/lead, reaproveitando o mesmo
 * caminho que o runCallPipeline usa depois de transcrever.
 */
export async function runTranscriptPipeline(
  uploadId: string,
  teamId: string,
  transcriptText: string,
  filename: string,
  userId: string,
  known?: { knownContactName?: string; knownPhone?: string }
): Promise<void> {
  const supabase = createServiceClient()

  try {
    await supabase
      .from('call_uploads')
      .update({
        transcript_text: transcriptText,
        whisper_model: 'external',
        status: 'analyzing',
        updated_at: new Date().toISOString(),
      })
      .eq('id', uploadId)

    await processTranscript(supabase, uploadId, teamId, transcriptText, filename, userId, known)
  } catch (err) {
    await marcarFalhado(supabase, uploadId, err)
  }
}

async function marcarFalhado(supabase: SupabaseClient, uploadId: string, err: unknown): Promise<void> {
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

async function processTranscript(
  supabase: SupabaseClient,
  uploadId: string,
  teamId: string,
  transcriptText: string,
  filename: string,
  userId: string,
  known?: { knownContactName?: string; knownPhone?: string }
): Promise<void> {
  // Passo a.5: Diarization via Haiku (Whisper-1 nao separa oradores).
    let transcriptFormatted: string | null = null
    try {
      const diarized = await diarizationAgent.reformat(transcriptText)
      transcriptFormatted = diarized.formatted
      await supabase
        .from('call_uploads')
        .update({ transcript_formatted: transcriptFormatted })
        .eq('id', uploadId)
    } catch (err) {
      console.warn('[call-pipeline] diarization failed, using raw transcript:', err)
    }

    const sourceText = transcriptFormatted ?? transcriptText

    const MAX_CHARS = 12000
    const analysisText =
      sourceText.length > MAX_CHARS
        ? sourceText.slice(0, MAX_CHARS * 0.7) +
          '\n\n[...transcricao resumida...]\n\n' +
          sourceText.slice(-MAX_CHARS * 0.3)
        : sourceText

    // Passo b: Carregar agent_learnings
    const { data: learningsData } = await supabase
      .from('agent_learnings')
      .select('content')
      .eq('team_id', teamId)
      .order('confidence', { ascending: false })
      .limit(5)
    const agentLearnings = (learningsData ?? []).map((l: { content: string }) => l.content)

    // Passo c: Criar agent_run
    const { data: run } = await supabase
      .from('agent_runs')
      .insert({
        team_id: teamId,
        agent_type: 'lead',
        trigger_type: 'n8n_webhook',
        lead_id: null,
        input_summary: `Analise de chamada: ${filename}`,
        status: 'running',
      })
      .select('id')
      .single()

    // Passo d: Lead agent
    const startMs = Date.now()
    let agentOutput: AgentFullOutput

    try {
      agentOutput = await leadAgent.analyze({
        leadName: 'Lead (chamada)',
        conversationText: analysisText,
        objective:
          'Analisar a chamada de fim a fim: (1) extrair nome, telefone, email, score, urgencia e perfil completo da lead; (2) sugerir ate 3 next_best_actions concretas (titulo, descricao, prioridade, due_in_hours); (3) redigir 1-2 drafts curtos para follow-up (WhatsApp e/ou email); (4) listar perguntas-chave em aberto e red flags relevantes.',
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
    const knownPhoneNormalized = known?.knownPhone ? normalizePhone(known.knownPhone) : undefined
    const extractedPhone = knownPhoneNormalized ?? normalizePhone(ex.phone ?? undefined)
    const knownNameTrimmed = known?.knownContactName?.trim()
    const extractedFullName =
      knownNameTrimmed && knownNameTrimmed.length > 0
        ? knownNameTrimmed
        : ex.full_name && ex.full_name.trim().length > 0
          ? ex.full_name.trim()
          : null
    const extractedEmail =
      ex.email && ex.email.trim().length > 0 ? ex.email.trim() : null
    const extractedScore = ex.score ?? null
    const extractedUrgency = ex.urgency ?? null
    // Tipo de lead (migration 015) — buyer | seller | both | unknown.
    // So aceita valores validos; ignora 'unknown' para nao sobrescrever uma lead ja classificada.
    const VALID_LEAD_TYPES = ['buyer', 'seller', 'both'] as const
    const extractedLeadType = (ex as { lead_type?: string }).lead_type
    const newLeadType = extractedLeadType && (VALID_LEAD_TYPES as readonly string[]).includes(extractedLeadType)
      ? extractedLeadType as 'buyer' | 'seller' | 'both'
      : null

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

        // Atualiza lead_type apenas se a lead estava 'unknown' (nao sobrepoe classificacao manual).
        if (newLeadType) {
          const { data: cur } = await supabase
            .from('leads')
            .select('lead_type')
            .eq('id', leadId)
            .single()
          if (!cur || cur.lead_type === 'unknown' || cur.lead_type === null) {
            leadUpdate.lead_type = newLeadType
          }
        }

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
          lead_type: newLeadType ?? 'unknown', // classifica logo na criacao se possivel
        })
        .select('id')
        .single()

      if (newLead) {
        leadId = newLead.id
      }
    }

    if (!leadId) throw new Error('Falhou a criar ou encontrar lead')

    const now = new Date().toISOString()

    // Passo f: agent_extractions — fica 'pending' (default da coluna). Perfil,
    // score/urgencia e tasks so sao aplicados quando o utilizador confirmar.
    const { error: extractionErr } = await supabase.from('agent_extractions').insert({
      team_id: teamId,
      lead_id: leadId,
      upload_id: uploadId,
      run_id: run?.id ?? null,
      extracted_json: agentOutput.lead_updates,
      recommendations_json: agentOutput.recommendations,
      drafts_json: agentOutput.drafts,
    })
    if (extractionErr) {
      console.warn('[call-pipeline] insert agent_extractions failed:', extractionErr.message)
    }

    // Passo g: Atualizar agent_run
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

    // Passo h: Coach feedback (nao altera a lead, pode ficar imediato)
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

    // Passo i: Registar interacao (log historico da chamada — nao e uma decisao)
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

    // Passo j: Notificar que ha uma extraccao pendente de revisao (mesmo padrao
    // usado por agents/matching, agents/followup e agents/coach-macro).
    await supabase.from('notifications').insert({
      team_id: teamId,
      type: 'agent_complete',
      title: '🤖 Nova análise por rever',
      body: `Chamada analisada — ${extractedFullName ?? existingLeadName ?? 'lead'}. Confirma para aplicar ao perfil.`,
      link: `/dashboard/leads/${leadId}`,
    })

  // Passo k: Marcar upload como done
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
}
