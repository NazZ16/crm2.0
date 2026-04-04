import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { coachMacroAgent } from '@/lib/agents/coach-macro-agent'

type ServiceClient = ReturnType<typeof createServiceClient>

export async function GET(request: Request) {
  // Vercel Cron sends X-Vercel-Cron: 1
  const isCron = request.headers.get('X-Vercel-Cron') === '1'
  if (!isCron) return NextResponse.json({ error: 'Método não permitido' }, { status: 405 })

  const serviceClient = createServiceClient()
  const { data: teams } = await serviceClient.from('teams').select('id')
  const results = []
  for (const team of teams ?? []) {
    const result = await runCoachMacro(serviceClient, team.id)
    results.push({ team_id: team.id, ...result })
  }
  return NextResponse.json({ teams_processed: results.length, results })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: member } = await supabase
    .from('team_members')
    .select('team_id, role')
    .eq('user_id', user.id)
    .single()

  if (!member) return NextResponse.json({ error: 'Equipa não encontrada' }, { status: 403 })
  if (member.role === 'viewer') return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })

  const serviceClient = createServiceClient()
  const result = await runCoachMacro(serviceClient, member.team_id)
  return NextResponse.json(result)
}

async function runCoachMacro(
  supabase: ServiceClient,
  teamId: string
): Promise<{ prioridades: number; learning_saved: boolean }> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString()

  const [openLeadsRes, wonLeadsRes, lostLeadsRes, learningsRes] = await Promise.all([
    supabase.from('leads')
      .select('id, full_name, score, urgency, status, last_contact_at')
      .eq('team_id', teamId)
      .not('status', 'in', '("won","lost")')
      .order('score', { ascending: false })
      .limit(20),
    supabase.from('leads')
      .select('full_name, source')
      .eq('team_id', teamId)
      .eq('status', 'won')
      .gte('updated_at', thirtyDaysAgo),
    supabase.from('leads')
      .select('full_name')
      .eq('team_id', teamId)
      .eq('status', 'lost')
      .gte('updated_at', thirtyDaysAgo),
    supabase.from('agent_learnings')
      .select('content')
      .eq('team_id', teamId)
      .order('created_at', { ascending: false })
      .limit(5),
  ])

  const report = await coachMacroAgent.analyze({
    openLeads: openLeadsRes.data ?? [],
    wonLeads: wonLeadsRes.data ?? [],
    lostLeads: lostLeadsRes.data ?? [],
    pastLearnings: (learningsRes.data ?? []).map((l: { content: string }) => l.content),
  })

  // Persist the learning
  let learningSaved = false
  if (report.learning) {
    const { error: learningError } = await supabase.from('agent_learnings').insert({
      team_id: teamId,
      learning_type: 'conversion_pattern',
      content: report.learning,
    })
    learningSaved = !learningError
  }

  // Create notification
  await supabase.from('notifications').insert({
    team_id: teamId,
    type: 'tip',
    title: 'Coach Macro — Relatório Semanal',
    body: report.padrao_semana ?? `${report.prioridades.length} prioridades identificadas esta semana`,
  })

  return { prioridades: report.prioridades.length, learning_saved: learningSaved }
}
