import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { coachAgent, type DealAnalysis } from '@/lib/agents/coach-agent'

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })

  const { data: member } = await supabase
    .from('team_members')
    .select('team_id')
    .eq('user_id', user.id)
    .single()

  if (!member) return NextResponse.json({ error: 'Sem permissao' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const type = searchParams.get('type') ?? 'tips'

  if (type === 'tips') {
    const [learningsRes, leadsRes] = await Promise.all([
      supabase
        .from('agent_learnings')
        .select('content, confidence, learning_type')
        .eq('team_id', member.team_id)
        .order('confidence', { ascending: false })
        .limit(8),
      supabase
        .from('leads')
        .select('status, score, urgency, source')
        .eq('team_id', member.team_id)
        .not('status', 'in', '(won,lost)')
        .limit(20),
    ])

    const learnings = (learningsRes.data ?? []).map((l: { content: string }) => l.content)
    const pipelineJson = JSON.stringify(leadsRes.data ?? [])

    if (learnings.length === 0) {
      return NextResponse.json({
        tips: 'Ainda nao ha aprendizagens suficientes. Analisa mais conversas para que o Coach aprenda os teus padroes.',
        learnings_count: 0,
      })
    }

    const tips = await coachAgent.getDailyTips(learnings, pipelineJson)
    return NextResponse.json({ tips, learnings_count: learnings.length })
  }

  if (type === 'weekly') {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

    const { data: recentLeads } = await supabase
      .from('leads')
      .select(`
        id, full_name, status, score, urgency, source, created_at, last_contact_at,
        lead_profiles(confidence_score, summary),
        interactions(id)
      `)
      .eq('team_id', member.team_id)
      .in('status', ['won', 'lost'])
      .gte('updated_at', thirtyDaysAgo)
      .limit(30)

    const { data: existingLearnings } = await supabase
      .from('agent_learnings')
      .select('content')
      .eq('team_id', member.team_id)
      .order('confidence', { ascending: false })
      .limit(10)

    if (!recentLeads || recentLeads.length < 3) {
      return NextResponse.json({
        insufficient_data: true,
        leads_found: recentLeads?.length ?? 0,
        leads_needed: 3,
        message: `Precisas de pelo menos 3 leads marcadas como ganhas ou perdidas nos ultimos 30 dias para o Coach extrair padroes (tens ${recentLeads?.length ?? 0}).`,
        learnings_added: 0,
      })
    }

    const deals: DealAnalysis[] = recentLeads.map((l) => {
      const profile = Array.isArray(l.lead_profiles) ? l.lead_profiles[0] : l.lead_profiles
      const interactionsCount = Array.isArray(l.interactions) ? l.interactions.length : 0
      const daysToClose = Math.floor(
        (new Date(l.last_contact_at ?? l.created_at).getTime() - new Date(l.created_at).getTime()) / (1000 * 60 * 60 * 24)
      )

      return {
        id: l.id,
        lead_name: l.full_name,
        status: l.status as 'won' | 'lost',
        source: l.source,
        score_at_close: l.score,
        urgency: l.urgency,
        days_to_close: Math.max(0, daysToClose),
        interactions_count: interactionsCount,
        key_factors: profile?.summary ? [profile.summary] : [],
      }
    })

    const existingContents = (existingLearnings ?? []).map((l: { content: string }) => l.content)

    const { data: run } = await supabase
      .from('agent_runs')
      .insert({
        team_id: member.team_id,
        agent_type: 'coach',
        trigger_type: 'manual',
        input_summary: 'Revisao semanal e extracao de aprendizagens',
        status: 'running',
      })
      .select('id')
      .single()

    const startMs = Date.now()
    let result
    try {
      result = await coachAgent.extractLearnings(deals, existingContents)
    } catch (err) {
      if (run) {
        await supabase
          .from('agent_runs')
          .update({
            status: 'failed',
            error: err instanceof Error ? err.message : String(err),
            duration_ms: Date.now() - startMs,
          })
          .eq('id', run.id)
      }
      return NextResponse.json({ error: 'Erro no Coach', details: err instanceof Error ? err.message : String(err) }, { status: 500 })
    }

    if (result.learnings.length > 0) {
      await supabase.from('agent_learnings').insert(
        result.learnings.map((l) => ({ ...l, team_id: member.team_id }))
      )
    }

    if (run) {
      await supabase
        .from('agent_runs')
        .update({ status: 'done', output_json: result, duration_ms: Date.now() - startMs })
        .eq('id', run.id)
    }

    return NextResponse.json({ learnings_added: result.learnings.length, learnings: result.learnings })
  }

  return NextResponse.json({ error: 'Tipo invalido' }, { status: 400 })
}
