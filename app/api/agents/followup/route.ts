import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { followupAgent, type LeadSummary } from '@/lib/agents/followup-agent'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: member } = await supabase
    .from('team_members')
    .select('team_id, role')
    .eq('user_id', user.id)
    .single()

  if (!member || member.role === 'viewer') {
    return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
  }

  // Fetch prioritised open leads: urgency ≥ 3, OR not contacted in 5+ days, OR never contacted
  const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString()

  const { data: leads } = await supabase
    .from('leads')
    .select(`
      id, full_name, status, urgency, score, last_contact_at, created_at,
      tasks(title, description, status)
    `)
    .eq('team_id', member.team_id)
    .not('status', 'in', '("won","lost")')
    .or(`urgency.gte.3,last_contact_at.lte.${fiveDaysAgo},last_contact_at.is.null`)
    .order('urgency', { ascending: false })
    .limit(15)

  if (!leads || leads.length === 0) {
    return NextResponse.json({ message: 'Sem leads para analisar', items: [] })
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

  // Create notification
  await supabase.from('notifications').insert({
    team_id: member.team_id,
    type: 'agent_complete',
    title: `Plano de Follow-up para ${today}`,
    body: plan.summary,
    link: '/dashboard',
  })

  return NextResponse.json(plan)
}
