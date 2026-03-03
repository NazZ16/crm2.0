import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { marketingAgent, type CampaignData } from '@/lib/agents/marketing-agent'

export async function POST() {
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

  // Fetch campaigns + aggregate metrics (last 30 days)
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  const [campaignsRes, metricsRes] = await Promise.all([
    supabase
      .from('campaigns')
      .select('id, name, platform, budget_daily, status')
      .eq('team_id', member.team_id)
      .neq('status', 'ended'),
    supabase
      .from('campaign_metrics')
      .select('campaign_id, spend, impressions, clicks, leads_count, conversions')
      .eq('team_id', member.team_id)
      .gte('date', since),
  ])

  const campaigns = campaignsRes.data ?? []
  const metrics = metricsRes.data ?? []

  if (campaigns.length === 0) {
    return NextResponse.json({ error: 'Sem campanhas activas para analisar' }, { status: 400 })
  }

  // Aggregate metrics per campaign
  const agg = metrics.reduce((acc, m) => {
    if (!acc[m.campaign_id]) {
      acc[m.campaign_id] = { spend: 0, impressions: 0, clicks: 0, leads: 0, conversions: 0 }
    }
    acc[m.campaign_id].spend += m.spend
    acc[m.campaign_id].impressions += m.impressions
    acc[m.campaign_id].clicks += m.clicks
    acc[m.campaign_id].leads += m.leads_count
    acc[m.campaign_id].conversions += m.conversions
    return acc
  }, {} as Record<string, { spend: number; impressions: number; clicks: number; leads: number; conversions: number }>)

  const campaignData: CampaignData[] = campaigns.map((c) => ({
    id: c.id,
    name: c.name,
    platform: c.platform,
    budget_daily: c.budget_daily,
    total_spend: agg[c.id]?.spend ?? 0,
    total_impressions: agg[c.id]?.impressions ?? 0,
    total_clicks: agg[c.id]?.clicks ?? 0,
    total_leads: agg[c.id]?.leads ?? 0,
    total_conversions: agg[c.id]?.conversions ?? 0,
    period_days: 30,
  }))

  // Create agent_run record
  const { data: run } = await supabase
    .from('agent_runs')
    .insert({
      team_id: member.team_id,
      agent_type: 'marketing',
      trigger_type: 'manual',
      input_summary: `Análise de ${campaignData.length} campanhas — últimos 30 dias`,
      status: 'running',
    })
    .select('id')
    .single()

  const startMs = Date.now()

  try {
    const analysis = await marketingAgent.analyzeCampaigns(campaignData)
    const durationMs = Date.now() - startMs

    // Update agent_run
    if (run) {
      await supabase
        .from('agent_runs')
        .update({
          status: 'done',
          output_json: analysis,
          duration_ms: durationMs,
        })
        .eq('id', run.id)
    }

    // Create notification
    await supabase.from('notifications').insert({
      team_id: member.team_id,
      type: 'agent_complete',
      title: 'Análise de Marketing Concluída',
      body: `${analysis.overall_insights[0] ?? 'Análise das campanhas disponível.'}`,
      metadata: { run_id: run?.id, campaigns_analysed: campaignData.length },
    })

    return NextResponse.json({ ...analysis, run_id: run?.id })
  } catch (err) {
    if (run) {
      await supabase
        .from('agent_runs')
        .update({ status: 'failed', error: String(err), duration_ms: Date.now() - startMs })
        .eq('id', run.id)
    }
    console.error('[MarketingAgent] Error:', err)
    return NextResponse.json({ error: 'Erro no agente de marketing' }, { status: 500 })
  }
}
