import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { orientatorAgent } from '@/lib/agents/orientator-agent'

export const revalidate = 1800 // 30 min cache

export async function GET() {
  const supabase = await createClient()

  // Auth
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  // Team membership
  const { data: memberData } = await supabase
    .from('team_members')
    .select('team_id')
    .eq('user_id', user.id)
    .single()

  if (!memberData) {
    return NextResponse.json({ error: 'Equipa não encontrada' }, { status: 403 })
  }

  const teamId = memberData.team_id
  const now = new Date()
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const endOfToday = new Date(now)
  endOfToday.setHours(23, 59, 59, 999)

  // Fetch all data in parallel
  const [urgentLeadsRes, tasksTodayRes, coldLeadsRes, matchesRes, learningRes] = await Promise.all([
    // Urgent leads: urgency >= 3 OR score >= 70, not won/lost
    supabase
      .from('leads')
      .select('id, full_name, score, urgency, last_contact_at')
      .eq('team_id', teamId)
      .not('status', 'in', '(won,lost)')
      .or('urgency.gte.3,score.gte.70')
      .order('urgency', { ascending: false })
      .limit(5),

    // Tasks due today (status open, due_at <= end of today)
    supabase
      .from('tasks')
      .select('title, lead_id')
      .eq('team_id', teamId)
      .eq('status', 'open')
      .lte('due_at', endOfToday.toISOString())
      .limit(5),

    // Cold leads count: last_contact_at < 7 days ago, not won/lost
    supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('team_id', teamId)
      .not('status', 'in', '(won,lost)')
      .lt('last_contact_at', sevenDaysAgo),

    // investor_matches count (suggested or presented = open)
    supabase
      .from('investor_matches')
      .select('id', { count: 'exact', head: true })
      .eq('team_id', teamId)
      .in('status', ['suggested', 'presented']),

    // Latest agent_learning
    supabase
      .from('agent_learnings')
      .select('content')
      .eq('team_id', teamId)
      .order('confidence', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const urgentLeads = (urgentLeadsRes.data ?? []) as {
    id: string
    full_name: string
    score: number
    urgency: number
    last_contact_at: string | null
  }[]

  const tasksDueToday = (tasksTodayRes.data ?? []) as { title: string; lead_id: string | null }[]
  const coldLeadsCount = coldLeadsRes.count ?? 0
  const openMatchesCount = matchesRes.count ?? 0
  const coachLearning = learningRes.error ? null : (learningRes.data?.content ?? null)

  try {
    const briefing = await orientatorAgent.generateBriefing({
      urgentLeads,
      tasksDueToday,
      coldLeadsCount,
      openMatchesCount,
      coachLearning,
    })
    return NextResponse.json(briefing)
  } catch (err) {
    console.error('[orientator] generateBriefing error:', err)
    return NextResponse.json({ error: 'Erro ao gerar briefing' }, { status: 500 })
  }
}
