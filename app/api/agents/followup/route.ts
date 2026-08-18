import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { followupAgent, type LeadSummary } from '@/lib/agents/followup-agent'

export const maxDuration = 120

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })

  const { data: member } = await supabase
    .from('team_members')
    .select('team_id, role')
    .eq('user_id', user.id)
    .single()

  if (!member || member.role === 'viewer') {
    return NextResponse.json({ error: 'Sem permissao' }, { status: 403 })
  }

  // Fetch leads prioritizadas: urgencia >=3 OU sem contacto ha >=5 dias OU nunca contactadas
  const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString()

  const { data: leads } = await supabase
    .from('leads')
    .select(`
      id, full_name, status, urgency, score, last_contact_at, created_at,
      tasks(title, description, status)
    `)
    .eq('team_id', member.team_id)
    .not('status', 'in', '(won,lost)')
    .or(`urgency.gte.3,last_contact_at.lte.${fiveDaysAgo},last_contact_at.is.null`)
    .order('urgency', { ascending: false })
    .limit(15)

  if (!leads || leads.length === 0) {
    return NextResponse.json({ message: 'Sem leads para analisar', items: [], tasks_created: 0 })
  }

  const now = Date.now()
  const leadsInput: LeadSummary[] = leads.map((l) => {
    const lastContact = l.last_contact_at ?? l.created_at
    const daysSinceContact = Math.floor((now - new Date(lastContact).getTime()) / (1000 * 60 * 60 * 24))
    const openTask = Array.isArray(l.tasks)
      ? l.tasks.find((t: { status: string; title: string }) => t.status === 'open')
      : null

    return {
      id: l.id,
      full_name: l.full_name,
      status: l.status,
      urgency: l.urgency,
      score: l.score,
      days_since_contact: daysSinceContact,
      next_action_description: openTask?.title,
    }
  })

  const today = new Date().toISOString().split('T')[0]

  const { data: run } = await supabase
    .from('agent_runs')
    .insert({
      team_id: member.team_id,
      agent_type: 'followup',
      trigger_type: 'manual',
      input_summary: `Plano de follow-up para ${today}`,
      status: 'running',
    })
    .select('id')
    .single()

  const startMs = Date.now()
  let plan

  try {
    plan = await followupAgent.generatePlan(leadsInput, today)
  } catch (err) {
    if (run) {
      await supabase
        .from('agent_runs')
        .update({ status: 'failed', error: String(err), duration_ms: Date.now() - startMs })
        .eq('id', run.id)
    }
    return NextResponse.json({ error: 'Erro no agente de follow-up' }, { status: 500 })
  }

  const durationMs = Date.now() - startMs

  if (run) {
    await supabase
      .from('agent_runs')
      .update({ status: 'done', output_json: plan, duration_ms: durationMs })
      .eq('id', run.id)
  }

  // Criar tarefas a partir dos items do plano.
  // Dedup: se ja existe uma tarefa aberta criada por agent para esse lead nas
  // ultimas 24h, saltamos para nao duplicar quando o plano corre varias vezes.
  let tasksCreated = 0
  const validLeadIds = new Set(leads.map((l) => l.id))
  // Tecto de 8 items aplicado no codigo — o prompt tambem pede isto, mas nao
  // ha garantia de que o modelo cumpra sempre.
  const items = (Array.isArray(plan.items) ? plan.items : []).slice(0, 8)
  plan.items = items

  if (items.length > 0) {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const itemLeadIds = items
      .map((i) => i.lead_id)
      .filter((id): id is string => typeof id === 'string' && validLeadIds.has(id))

    let recentByLead = new Map<string, true>()
    if (itemLeadIds.length > 0) {
      const { data: recent } = await supabase
        .from('tasks')
        .select('lead_id')
        .eq('team_id', member.team_id)
        .eq('status', 'open')
        .eq('created_by', 'agent')
        .gte('created_at', oneDayAgo)
        .in('lead_id', itemLeadIds)
      recentByLead = new Map((recent ?? []).map((t: { lead_id: string }) => [t.lead_id, true]))
    }

    const allowed = new Set<'low' | 'medium' | 'high' | 'urgent'>([
      'low',
      'medium',
      'high',
      'urgent',
    ])

    // Due-at = fim do dia de hoje (23:59 local server-side, em UTC para o registo)
    const endOfToday = new Date()
    endOfToday.setUTCHours(23, 59, 0, 0)
    const dueAtIso = endOfToday.toISOString()

    type TaskInsert = {
      team_id: string
      lead_id: string
      assigned_to: string
      title: string
      description: string | null
      priority: 'low' | 'medium' | 'high' | 'urgent'
      due_at: string
      status: 'open'
      created_by: 'agent'
    }

    const toInsert: TaskInsert[] = []
    for (const item of items) {
      if (!item || typeof item.lead_id !== 'string') continue
      if (!validLeadIds.has(item.lead_id)) continue
      if (recentByLead.has(item.lead_id)) continue

      const action = (item.action ?? '').toString().trim()
      const reason = (item.reason ?? '').toString().trim()
      const draft = (item.draft_message ?? '').toString().trim()
      const title = action.length > 0 ? action.slice(0, 200) : 'Follow-up de hoje'
      const descriptionParts = [
        reason ? `Motivo: ${reason}` : null,
        draft ? `Rascunho: ${draft}` : null,
      ].filter((s): s is string => !!s)
      const description = descriptionParts.length > 0 ? descriptionParts.join('\n\n') : null

      const rawPrio = String(item.priority ?? 'medium').toLowerCase()
      const priority = (allowed.has(rawPrio as 'low' | 'medium' | 'high' | 'urgent')
        ? rawPrio
        : 'medium') as 'low' | 'medium' | 'high' | 'urgent'

      toInsert.push({
        team_id: member.team_id,
        lead_id: item.lead_id,
        assigned_to: user.id,
        title,
        description,
        priority,
        due_at: dueAtIso,
        status: 'open',
        created_by: 'agent',
      })
    }

    if (toInsert.length > 0) {
      const { data: inserted, error: tasksErr } = await supabase
        .from('tasks')
        .insert(toInsert)
        .select('id')
      if (tasksErr) {
        console.warn('[agents/followup] insert tasks failed:', tasksErr.message)
      } else {
        tasksCreated = inserted?.length ?? 0
      }
    }
  }

  // Notificacao
  await supabase.from('notifications').insert({
    team_id: member.team_id,
    type: 'agent_complete',
    title: `Plano de Follow-up para ${today}`,
    body: `${plan.summary} (${tasksCreated} tarefas criadas)`,
    link: '/dashboard',
  })

  return NextResponse.json({
    ...plan,
    tasks_created: tasksCreated,
  })
}
