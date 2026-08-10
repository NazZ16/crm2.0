// lib/apply-extraction.ts
// Aplica (ou descarta) uma extraccao de IA pendente. Antes desta mudanca, tanto
// o fluxo manual ("Analisar Conversa") como o pipeline automatico de chamadas
// escreviam directamente no perfil da lead e criavam tarefas sem revisao — cada
// um com a sua propria copia da logica de merge. Este modulo centraliza essa
// logica e so corre quando o utilizador confirma explicitamente ("Aplicar").

import type { SupabaseClient } from '@supabase/supabase-js'
import { applyAutoTaskOnStatusChange } from '@/lib/auto-tasks'
import { buildLeadPreferenceEmbeddingText, regenerateLeadProfileEmbedding } from '@/lib/embeddings'
import type { LeadProfile, AgentExtractionResult, AgentAction, LeadType, LeadStatus } from '@/lib/types'

export function mergeProfileField<T>(
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

const priorityMap: Record<string, 'low' | 'medium' | 'high' | 'urgent'> = {
  high: 'high', medium: 'medium', low: 'low', urgent: 'urgent',
  alta: 'high', media: 'medium', 'média': 'medium', baixa: 'low', urgente: 'urgent',
}

type NormalizedAction = {
  title: string
  description: string
  priority: 'low' | 'medium' | 'high' | 'urgent'
  due_in_hours: number | null
}

function normalizeActions(rawActions: AgentAction[] | unknown[]): NormalizedAction[] {
  return (rawActions as Array<Record<string, unknown>>)
    .map((a) => {
      const title = (a.title ?? a.titulo ?? '') as string
      const description = (a.description ?? a.descricao ?? a['descrição'] ?? '') as string
      const rawPrio = String(a.priority ?? a.prioridade ?? 'medium').toLowerCase()
      const priority = priorityMap[rawPrio] ?? 'medium'
      const dueRaw = a.due_in_hours ?? a.prazo_horas ?? a.due_hours ?? null
      const due = typeof dueRaw === 'number' && Number.isFinite(dueRaw) ? dueRaw : null
      return { title: String(title).trim(), description: String(description).trim(), priority, due_in_hours: due }
    })
    .filter((a) => a.title.length > 0)
}

async function createFollowUpSequence(
  supabase: SupabaseClient,
  teamId: string,
  leadId: string,
  userId: string | null
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
      team_id: teamId, lead_id: leadId, assigned_to: userId,
      title: 'Follow-up inicial - contacto recente',
      description: 'Contactar lead apos analise recente. Urgencia elevada.',
      due_at: now.toISOString(), status: 'open', priority: 'urgent', created_by: 'agent',
    },
    {
      team_id: teamId, lead_id: leadId, assigned_to: userId,
      title: 'Follow-up 3 dias - verificar interesse',
      description: 'Verificar interesse da lead apos contacto inicial.',
      due_at: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      status: 'open', priority: 'high', created_by: 'agent',
    },
    {
      team_id: teamId, lead_id: leadId, assigned_to: userId,
      title: 'Follow-up 7 dias - decisao final',
      description: 'Obter decisao final da lead ou reagendar.',
      due_at: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      status: 'open', priority: 'medium', created_by: 'agent',
    },
  ])
}

export interface ApplyExtractionResult {
  ok: boolean
  error?: string
  tasksCreated?: number
  autoBumped?: boolean
}

/**
 * Aplica uma extraccao 'pending': merge no lead_profiles, actualiza score/urgencia/
 * last_contact_at, cria tasks a partir de next_best_actions. Se a extraccao veio do
 * pipeline automatico (agent_runs.trigger_type != 'manual') e a lead estava 'new',
 * faz tambem o auto-bump para 'qualified' + auto-tasks da transicao.
 */
export async function applyExtraction(
  supabase: SupabaseClient,
  extractionId: string
): Promise<ApplyExtractionResult> {
  const { data: extraction, error: exErr } = await supabase
    .from('agent_extractions')
    .select('*')
    .eq('id', extractionId)
    .single()

  if (exErr || !extraction) return { ok: false, error: 'Extração não encontrada' }
  if (extraction.status !== 'pending') return { ok: false, error: 'Extração já foi processada' }

  const leadId = extraction.lead_id as string
  const teamId = extraction.team_id as string
  const ex = extraction.extracted_json as AgentExtractionResult

  const [{ data: existingProfile }, { data: leadRow }] = await Promise.all([
    supabase.from('lead_profiles').select('*').eq('lead_id', leadId).maybeSingle() as unknown as Promise<{ data: LeadProfile | null }>,
    supabase.from('leads').select('status, lead_type, assigned_to, notes').eq('id', leadId).single(),
  ])

  const now = new Date().toISOString()

  const sellerProfileFromAgent = (ex as { seller_profile?: unknown }).seller_profile
  const mergedHomePreferences = mergeProfileField(existingProfile?.home_preferences, ex.home_preferences)

  await supabase.from('lead_profiles').upsert(
    {
      lead_id: leadId,
      home_preferences: mergedHomePreferences,
      financial_profile: mergeProfileField(existingProfile?.financial_profile, ex.financial_profile),
      personality_traits: mergeProfileField(existingProfile?.personality_traits, ex.personality_traits),
      family_context: mergeProfileField(existingProfile?.family_context, ex.family_context),
      fears_objections: mergeProfileField(existingProfile?.fears_objections, ex.fears_objections),
      process_preferences: mergeProfileField(existingProfile?.process_preferences, ex.process_preferences),
      seller_profile: mergeProfileField(
        (existingProfile as { seller_profile?: Record<string, unknown> | null })?.seller_profile,
        sellerProfileFromAgent as Partial<Record<string, unknown>> | null | undefined
      ),
      summary: ex.summary || existingProfile?.summary || null,
      confidence_score: ex.confidence_score,
      updated_at: now,
    },
    { onConflict: 'lead_id' }
  )

  // Regenerar embedding semântico do perfil — best-effort, nunca bloqueia a
  // aplicação da extração. await directo (não after()) porque esta função
  // já corre por vezes dentro de um after() do pipeline automático
  // (Telegram/ingest), e encadear after() dentro de after() não vale o risco
  // por uma chamada que já é barata.
  const hasPreferenceContent = mergedHomePreferences
    ? Object.values(mergedHomePreferences).some((v) => v != null && (Array.isArray(v) ? v.length > 0 : true))
    : false
  if (hasPreferenceContent) {
    try {
      await regenerateLeadProfileEmbedding(
        supabase,
        leadId,
        buildLeadPreferenceEmbeddingText(mergedHomePreferences, (leadRow?.notes as string | null) ?? null)
      )
    } catch (err) {
      console.warn('[apply-extraction] regenerar embedding falhou:', err)
    }
  }

  await supabase
    .from('leads')
    .update({ score: ex.score, urgency: ex.urgency, last_contact_at: now })
    .eq('id', leadId)

  // Tasks a partir de next_best_actions
  const recommendations = extraction.recommendations_json as { next_best_actions?: unknown[] } | null
  const normalizedActions = normalizeActions(recommendations?.next_best_actions ?? [])
  let tasksCreated = 0

  if (normalizedActions.length > 0) {
    const tasksToCreate = normalizedActions.slice(0, 3).map((action) => ({
      lead_id: leadId,
      team_id: teamId,
      assigned_to: (leadRow?.assigned_to as string | null) ?? null,
      title: action.title,
      description: action.description || null,
      priority: action.priority,
      created_by: 'agent' as const,
      due_at: action.due_in_hours
        ? new Date(Date.now() + action.due_in_hours * 60 * 60 * 1000).toISOString()
        : null,
      status: 'open' as const,
    }))
    const { data: inserted, error: tasksErr } = await supabase.from('tasks').insert(tasksToCreate).select('id')
    if (tasksErr) console.warn('[apply-extraction] insert tasks failed:', tasksErr.message)
    tasksCreated = inserted?.length ?? 0
  }

  if (tasksCreated === 0 && ex.urgency != null && ex.urgency >= 3) {
    await createFollowUpSequence(supabase, teamId, leadId, (leadRow?.assigned_to as string | null) ?? null)
  }

  // Auto-bump new->qualified, so quando a extraccao veio do pipeline automatico
  // (nao do fluxo manual "Analisar Conversa").
  let autoBumped = false
  if (extraction.run_id) {
    const { data: run } = await supabase
      .from('agent_runs')
      .select('trigger_type')
      .eq('id', extraction.run_id)
      .single()

    if (run && run.trigger_type !== 'manual' && leadRow?.status === 'new') {
      await supabase.from('leads').update({ status: 'qualified', last_contact_at: now }).eq('id', leadId)
      autoBumped = true
      try {
        await applyAutoTaskOnStatusChange(supabase, {
          leadId,
          teamId,
          oldStatus: 'new' as LeadStatus,
          newStatus: 'qualified' as LeadStatus,
          leadType: ((leadRow.lead_type as LeadType | null | undefined) ?? 'unknown') as LeadType,
          assignedTo: (leadRow.assigned_to as string | null) ?? null,
        })
      } catch (err) {
        console.warn('[apply-extraction] auto-task on bump failed:', err)
      }
    }
  }

  await supabase
    .from('agent_extractions')
    .update({ status: 'applied', applied_at: now })
    .eq('id', extractionId)

  return { ok: true, tasksCreated, autoBumped }
}

export async function dismissExtraction(
  supabase: SupabaseClient,
  extractionId: string
): Promise<ApplyExtractionResult> {
  const { data, error } = await supabase
    .from('agent_extractions')
    .update({ status: 'dismissed', applied_at: new Date().toISOString() })
    .eq('id', extractionId)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle()

  if (error) return { ok: false, error: error.message }
  if (!data) return { ok: false, error: 'Extração não encontrada ou já processada' }
  return { ok: true }
}
