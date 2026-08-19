// lib/lead-analysis.ts — compila todo o historico de interacoes de uma lead (chamadas,
// whatsapp, notas, email) e corre o lead-agent sobre ele. Extraido de
// app/api/leads/[id]/analyze-all/route.ts para ser reutilizavel pelo cron semanal
// (lib/weekly-lead-analysis.ts) sem duplicar a logica.
import type { SupabaseClient } from '@supabase/supabase-js'
import { leadAgent } from '@/lib/agents/lead-agent'
import type { AgentFullOutput, LeadProfile } from '@/lib/types'

const MAX_CHARS = 12000

const OBJECTIVE =
  'Compilar todo o histórico de interações (chamadas, WhatsApp, notas) e atualizar o perfil ' +
  'completo de comprador/vendedor, com recomendações de próximos passos e rascunhos de follow-up.'

interface InteractionRow {
  type: string
  raw_text: string | null
  summary: string | null
  occurred_at: string
}

function buildConversationText(interactions: InteractionRow[]): string {
  const blocks = interactions
    .map((i) => {
      const content = i.raw_text ?? i.summary
      if (!content) return null
      const when = new Date(i.occurred_at).toLocaleString('pt-PT')
      return `[${i.type} — ${when}]\n${content}`
    })
    .filter((b): b is string => b !== null)

  const fullText = blocks.join('\n---\n')

  return fullText.length > MAX_CHARS
    ? fullText.slice(0, MAX_CHARS * 0.7) +
        '\n\n[...histórico resumido...]\n\n' +
        fullText.slice(-MAX_CHARS * 0.3)
    : fullText
}

export interface AnalyzeLeadFullHistoryInput {
  leadId: string
  teamId: string
  triggerType: 'manual' | 'weekly_cron'
}

export type AnalyzeLeadFullHistoryResult =
  | { status: 'not_found' }
  | { status: 'no_interactions' }
  | {
      status: 'ok'
      leadId: string
      extractionId: string | undefined
      runId: string | undefined
      interactionCount: number
      output: AgentFullOutput
    }

export async function analyzeLeadFullHistory(
  supabase: SupabaseClient,
  { leadId, teamId, triggerType }: AnalyzeLeadFullHistoryInput
): Promise<AnalyzeLeadFullHistoryResult> {
  const { data: lead } = await supabase
    .from('leads')
    .select('id, full_name')
    .eq('id', leadId)
    .eq('team_id', teamId)
    .single()

  if (!lead) return { status: 'not_found' }

  const { data: interactions } = await supabase
    .from('interactions')
    .select('type, raw_text, summary, occurred_at')
    .eq('lead_id', leadId)
    .eq('team_id', teamId)
    .order('occurred_at', { ascending: true })

  const conversationText = buildConversationText((interactions ?? []) as InteractionRow[])
  if (!conversationText) return { status: 'no_interactions' }

  const [profileRes, learningsRes] = await Promise.all([
    supabase.from('lead_profiles').select('*').eq('lead_id', leadId).single(),
    supabase
      .from('agent_learnings')
      .select('content')
      .eq('team_id', teamId)
      .order('confidence', { ascending: false })
      .limit(5),
  ])

  const existingProfile = profileRes.data as LeadProfile | null
  const agentLearnings = (learningsRes.data ?? []).map((l: { content: string }) => l.content)

  const { data: run } = await supabase
    .from('agent_runs')
    .insert({
      team_id: teamId,
      agent_type: 'lead',
      trigger_type: triggerType,
      lead_id: leadId,
      input_summary: `Análise de histórico completo (${(interactions ?? []).length} interações)`,
      status: 'running',
    })
    .select('id')
    .single()

  const startMs = Date.now()
  let output: AgentFullOutput

  try {
    output = await leadAgent.analyze({
      leadName: lead.full_name,
      conversationText,
      objective: OBJECTIVE,
      existingProfile: existingProfile ?? undefined,
      agentLearnings,
    })
  } catch (err) {
    if (run) {
      await supabase
        .from('agent_runs')
        .update({ status: 'failed', error: String(err), duration_ms: Date.now() - startMs })
        .eq('id', run.id)
    }
    throw err
  }

  const durationMs = Date.now() - startMs
  const meta = (output as AgentFullOutput & { _meta?: { tokens?: number } })._meta
  delete (output as AgentFullOutput & { _meta?: unknown })._meta

  const { data: extraction } = await supabase
    .from('agent_extractions')
    .insert({
      team_id: teamId,
      lead_id: leadId,
      upload_id: null,
      run_id: run?.id ?? null,
      extracted_json: output.lead_updates,
      recommendations_json: output.recommendations,
      drafts_json: output.drafts,
    })
    .select('id')
    .single()

  if (run) {
    await supabase
      .from('agent_runs')
      .update({
        status: 'done',
        output_json: output,
        tokens_used: meta?.tokens ?? null,
        duration_ms: durationMs,
      })
      .eq('id', run.id)
  }

  await supabase.from('notifications').insert({
    team_id: teamId,
    type: 'agent_complete',
    title: '🤖 Nova análise por rever',
    body: `${lead.full_name} — histórico analisado${triggerType === 'weekly_cron' ? ' automaticamente' : ''}. Confirma para aplicar ao perfil.`,
    link: `/dashboard/leads/${leadId}`,
  })

  return {
    status: 'ok',
    leadId,
    extractionId: extraction?.id,
    runId: run?.id,
    interactionCount: (interactions ?? []).length,
    output,
  }
}
