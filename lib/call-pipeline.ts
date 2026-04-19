// lib/call-pipeline.ts
// Lógica de pipeline partilhada entre /api/calls/upload e /api/share-target.

import { transcribeAudio } from '@/lib/whisper'
import { leadAgent } from '@/lib/agents/lead-agent'
import { callCoachAgent } from '@/lib/agents/call-coach-agent'
import { createServiceClient } from '@/lib/supabase/server'
import { normalizePhone } from '@/lib/phone'

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
    // O início tem a apresentação/dados da lead; o fim tem a conclusão/próximos passos
    const MAX_CHARS = 12000
    const analysisText =
      transcriptText.length > MAX_CHARS
        ? transcriptText.slice(0, MAX_CHARS * 0.7) +
          '\n\n[...transcrição resumida...]\n\n' +
          transcriptText.slice(-MAX_CHARS * 0.3)
        : transcriptText

    // Passo b: Agente de lead — extrair dados
    const agentOutput = await leadAgent.analyze({
      leadName: 'Lead (chamada)',
      conversationText: analysisText,
      objective: 'Extrair número de telefone (campo crítico para deduplicação), nome completo, score e urgência desta chamada.',
    })

    const leadUpdates = agentOutput.lead_updates as unknown as {
      phone?: string
      score?: number
      urgency?: number
      summary?: string
    }

    const extractedPhone = normalizePhone(leadUpdates.phone)
    const extractedScore = leadUpdates.score ?? null
    const extractedUrgency = leadUpdates.urgency ?? null
    const extractedSummary = agentOutput.lead_updates.summary ?? null

    // Passo c: Dedup por telefone
    // Nota: assume que os telefones na BD estão normalizados (via normalizePhone no insert).
    // Leads antigas com formato não-normalizado podem não ser detetadas como duplicadas.
    let leadId: string | null = null

    if (extractedPhone) {
      const { data: existingLead } = await supabase
        .from('leads')
        .select('id, full_name')
        .eq('team_id', teamId)
        .eq('phone', extractedPhone)
        .maybeSingle()

      if (existingLead) {
        leadId = existingLead.id
        await supabase
          .from('leads')
          .update({
            score: extractedScore,
            urgency: extractedUrgency,
            last_contact_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', leadId)
      }
    }

    if (!leadId) {
      const { data: newLead } = await supabase
        .from('leads')
        .insert({
          team_id: teamId,
          assigned_to: userId,
          full_name: 'Lead (chamada)',
          phone: extractedPhone,
          status: 'new',
          source: 'call_upload',
          score: extractedScore,
          urgency: extractedUrgency,
        })
        .select('id')
        .single()

      if (newLead) {
        leadId = newLead.id
        await supabase.from('lead_profiles').insert({ lead_id: leadId })
      }
    }

    if (!leadId) throw new Error('Falhou a criar ou encontrar lead')

    // Passo d: Contexto de interações recentes para o coach
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

    // Passo e: Coach agent
    const coachFeedback = await callCoachAgent.analyze(
      analysisText,
      'Lead (chamada)',
      summaries
    )

    // Passo f: Registar interação
    const interactionSummary = [
      extractedSummary,
      `Sentimento: ${coachFeedback.sentimento_lead}`,
    ]
      .filter(Boolean)
      .join(' | ')

    await supabase.from('interactions').insert({
      lead_id: leadId,
      team_id: teamId,
      type: 'call',
      raw_text: transcriptText, // guardar transcrição completa na BD
      summary: interactionSummary,
      occurred_at: new Date().toISOString(),
    })

    // Passo g: Follow-up tasks se urgência >= 3
    if (extractedUrgency != null && extractedUrgency >= 3) {
      await createFollowUpSequence(supabase, teamId, leadId, userId)
    }

    // Passo h: Marcar como done
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
