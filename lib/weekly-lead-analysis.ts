// lib/weekly-lead-analysis.ts — corre analyzeLeadFullHistory (lib/lead-analysis.ts) uma vez
// por semana, só para leads que tiveram pelo menos uma interação nos últimos 7 dias. Usado
// pelo cron /api/cron/weekly-lead-analysis. Mantém o custo de IA controlado: nada corre por
// mensagem, só semanalmente e só para quem teve conversa nova.
import type { SupabaseClient } from '@supabase/supabase-js'
import { analyzeLeadFullHistory } from '@/lib/lead-analysis'

export interface WeeklyAnalysisOutcome {
  leadId: string
  leadName: string
  status: 'ok' | 'no_interactions' | 'error'
  error?: string
}

export async function runWeeklyLeadAnalysis(
  supabase: SupabaseClient
): Promise<WeeklyAnalysisOutcome[]> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const { data: recentInteractions } = await supabase
    .from('interactions')
    .select('lead_id')
    .gte('occurred_at', since)

  const leadIds = [...new Set((recentInteractions ?? []).map((i: { lead_id: string }) => i.lead_id))]
  if (leadIds.length === 0) return []

  const { data: leads } = await supabase
    .from('leads')
    .select('id, team_id, full_name')
    .in('id', leadIds)

  const outcomes: WeeklyAnalysisOutcome[] = []

  for (const lead of leads ?? []) {
    try {
      const result = await analyzeLeadFullHistory(supabase, {
        leadId: lead.id,
        teamId: lead.team_id,
        triggerType: 'weekly_cron',
      })

      if (result.status === 'ok') {
        outcomes.push({ leadId: lead.id, leadName: lead.full_name, status: 'ok' })
        console.log(`[weekly-lead-analysis] analisada: ${lead.full_name}`)
      } else if (result.status === 'no_interactions') {
        outcomes.push({ leadId: lead.id, leadName: lead.full_name, status: 'no_interactions' })
      } else {
        outcomes.push({ leadId: lead.id, leadName: lead.full_name, status: 'error', error: 'lead não encontrada' })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn(`[weekly-lead-analysis] falhou lead ${lead.id} (${lead.full_name}): ${message}`)
      outcomes.push({ leadId: lead.id, leadName: lead.full_name, status: 'error', error: message })
    }
  }

  return outcomes
}
