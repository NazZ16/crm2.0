// lib/stale-leads.ts
// Logica para detectar leads "stale" (sem contacto ha demasiado tempo) e criar
// tasks automaticas de recontacto. Usado pelo cron /api/cron/stale-leads.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { LeadStatus, TaskPriority } from '@/lib/types'

// Quantos dias podem passar sem contacto antes de a lead ser considerada stale, por status.
// new = nao aplica (auto-bump trata). won/lost = terminal, nao aplica.
const STALE_THRESHOLD_DAYS: Partial<Record<LeadStatus, number>> = {
  qualified: 5,
  meeting: 2,    // reuniao agendada/feita arrefece muito rapido
  active: 7,     // em negociacao
}

// Tag invisivel na description, garante que so existe 1 task stale por lead.
const STALE_TAG = '[auto:stale]'

interface StaleLead {
  id: string
  team_id: string
  full_name: string
  status: LeadStatus
  score: number
  last_contact_at: string | null
  created_at: string
  assigned_to: string | null
}

function priorityFromScore(base: TaskPriority, score: number): TaskPriority {
  // Score alto faz upgrade da prioridade
  if (score >= 80) {
    if (base === 'medium') return 'high'
    if (base === 'low') return 'medium'
  }
  return base
}

/**
 * Encontra leads stale e cria task "Recontactar — Nome" para cada uma.
 * Idempotente: se ja existe task aberta com tag [auto:stale] para a lead, salta.
 *
 * @returns lista de objectos {leadId, leadName, daysIdle} para as tasks criadas
 */
export async function processStaleLeads(svc: SupabaseClient): Promise<
  Array<{ leadId: string; leadName: string; daysIdle: number; status: LeadStatus }>
> {
  const now = new Date()
  const created: Array<{ leadId: string; leadName: string; daysIdle: number; status: LeadStatus }> = []

  // Para cada status com threshold, calcula a data limite e busca leads
  for (const [status, threshold] of Object.entries(STALE_THRESHOLD_DAYS)) {
    if (!threshold) continue
    const cutoffDate = new Date(now.getTime() - threshold * 24 * 60 * 60 * 1000).toISOString()

    // Considera last_contact_at; se for null, usa created_at (lead recem-criada nunca contactada).
    // Como Postgres nao permite COALESCE em filtros simples do PostgREST, usamos OR:
    //   last_contact_at < cutoff  OR  (last_contact_at IS NULL AND created_at < cutoff)
    const { data: leadsStale, error } = await svc
      .from('leads')
      .select('id, team_id, full_name, status, score, last_contact_at, created_at, assigned_to')
      .eq('status', status)
      .or(`last_contact_at.lt.${cutoffDate},and(last_contact_at.is.null,created_at.lt.${cutoffDate})`)
      .limit(500)

    if (error) {
      console.warn(`[stale-leads] query falhou para ${status}: ${error.message}`)
      continue
    }

    const leads = (leadsStale ?? []) as StaleLead[]

    for (const lead of leads) {
      // Dedup — ja existe task aberta com tag stale para esta lead?
      const { data: existing } = await svc
        .from('tasks')
        .select('id')
        .eq('lead_id', lead.id)
        .eq('team_id', lead.team_id)
        .eq('status', 'open')
        .like('description', `%${STALE_TAG}%`)
        .maybeSingle()

      if (existing) continue

      const ref = lead.last_contact_at ?? lead.created_at
      const daysIdle = Math.floor((now.getTime() - new Date(ref).getTime()) / (24 * 60 * 60 * 1000))

      // Prioridade base depende do status
      const basePriority: TaskPriority =
        lead.status === 'meeting' ? 'high' : lead.status === 'qualified' ? 'medium' : 'medium'
      const priority = priorityFromScore(basePriority, lead.score)

      const dueAt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0).toISOString()

      const description =
        `Sem contacto ha ${daysIdle} dias (status: ${lead.status}, score ${lead.score}). ` +
        `Manda mensagem curta a perguntar se ainda esta a procurar/vender ou se as circunstancias mudaram. ` +
        `Se ja la vai longe, propoe proxima accao concreta (visita, shortlist nova, revisao de preco).` +
        `\n\n${STALE_TAG}`

      const { error: insertErr } = await svc.from('tasks').insert({
        team_id: lead.team_id,
        lead_id: lead.id,
        title: `Recontactar — ${lead.full_name}`,
        description,
        priority,
        status: 'open',
        due_at: dueAt,
        assigned_to: lead.assigned_to,
        created_by: 'agent',
      })

      if (insertErr) {
        console.warn(`[stale-leads] insert falhou para ${lead.id}: ${insertErr.message}`)
        continue
      }

      created.push({ leadId: lead.id, leadName: lead.full_name, daysIdle, status: lead.status })
      console.log(`[stale-leads] task criada para ${lead.full_name} (${lead.status}, ${daysIdle}d)`)
    }
  }

  return created
}
