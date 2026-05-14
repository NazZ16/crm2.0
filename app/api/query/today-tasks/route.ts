// /api/query/today-tasks
// Lista tarefas abertas com due_at <= fim do dia (inclui atrasadas).
// Usado pela tool query_crm_today_tasks.

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { isHubAuthorized, resolveTeamId } from '@/lib/hub-auth'

export async function GET(request: Request) {
  if (!isHubAuthorized(request)) {
    return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })
  }
  const teamId = resolveTeamId(request)
  if (!teamId) return NextResponse.json({ error: 'team_id em falta' }, { status: 400 })

  const svc = createServiceClient()
  const now = new Date()
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString()

  const { data: tasks, error } = await svc
    .from('tasks')
    .select('id, title, priority, due_at, lead_id, leads(full_name)')
    .eq('team_id', teamId)
    .eq('status', 'open')
    .lte('due_at', endOfDay)
    .order('due_at', { ascending: true })
    .limit(30)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const enriched = (tasks ?? []).map((t) => {
    const lead = Array.isArray(t.leads) ? t.leads[0] : t.leads
    const overdue = t.due_at != null && new Date(t.due_at as string) < now
    return {
      id: t.id,
      title: t.title,
      priority: t.priority,
      due_at: t.due_at,
      lead_id: t.lead_id,
      lead_name: lead?.full_name ?? null,
      overdue,
    }
  })

  const overdueCount = enriched.filter((t) => t.overdue).length
  return NextResponse.json({
    total: enriched.length,
    overdue_count: overdueCount,
    tasks: enriched,
  })
}
