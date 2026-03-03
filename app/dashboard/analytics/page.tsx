import { createClient } from '@/lib/supabase/server'
import { Card, CardContent } from '@/components/ui/card'
import { LEAD_STATUS_LABELS, LEAD_PIPELINE_ORDER, type LeadStatus } from '@/lib/types'
import { Users, TrendingUp, Award, XCircle } from 'lucide-react'
import type { AnalyticsChartsData } from './AnalyticsCharts'
import ChartsLoader from './ChartsLoader'

export const dynamic = 'force-dynamic'

const PIPELINE_COLORS: Record<LeadStatus, string> = {
  new: '#6366f1',
  qualified: '#8b5cf6',
  meeting: '#f59e0b',
  active: '#22c55e',
  won: '#10b981',
  lost: '#ef4444',
}

const AGENT_LABELS: Record<string, string> = {
  lead: 'Lead',
  followup: 'Follow-up',
  coach: 'Coach',
  marketing: 'Marketing',
  investor: 'Investidor',
}

export default async function AnalyticsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: member } = await supabase
    .from('team_members')
    .select('team_id')
    .eq('user_id', user.id)
    .single()

  if (!member) return null

  // ── Fetch all data in parallel ──────────────────────────────────────────────
  const [leadsRes, agentRunsRes] = await Promise.all([
    supabase
      .from('leads')
      .select('status, score, urgency, source, created_at')
      .eq('team_id', member.team_id),
    supabase
      .from('agent_runs')
      .select('agent_type, status, created_at')
      .eq('team_id', member.team_id)
      .eq('status', 'done'),
  ])

  const allLeads = leadsRes.data ?? []
  const allRuns = agentRunsRes.data ?? []

  // ── Top-level KPIs ──────────────────────────────────────────────────────────
  const total = allLeads.length
  const won = allLeads.filter((l) => l.status === 'won').length
  const lost = allLeads.filter((l) => l.status === 'lost').length
  const active = allLeads.filter((l) => !['won', 'lost'].includes(l.status)).length
  const convRate = total > 0 ? ((won / total) * 100).toFixed(1) : '0.0'
  const avgScore = total > 0
    ? Math.round(allLeads.reduce((s, l) => s + (l.score ?? 0), 0) / total)
    : 0

  // ── Weekly leads (last 8 weeks) ─────────────────────────────────────────────
  const now = new Date()
  const weeklyData = Array.from({ length: 8 }, (_, i) => {
    const offset = 7 - i
    const weekStart = new Date(now)
    weekStart.setDate(now.getDate() - offset * 7)
    weekStart.setHours(0, 0, 0, 0)
    const weekEnd = new Date(weekStart)
    weekEnd.setDate(weekStart.getDate() + 7)
    const leads = allLeads.filter((l) => {
      const d = new Date(l.created_at)
      return d >= weekStart && d < weekEnd
    }).length
    const label = `${String(weekStart.getDate()).padStart(2, '0')}/${String(weekStart.getMonth() + 1).padStart(2, '0')}`
    return { week: label, leads }
  })

  // ── Pipeline funnel ─────────────────────────────────────────────────────────
  const byStatus = LEAD_PIPELINE_ORDER.reduce((acc, s) => {
    acc[s] = allLeads.filter((l) => l.status === s).length
    return acc
  }, {} as Record<LeadStatus, number>)

  const pipelineData = LEAD_PIPELINE_ORDER.map((status) => ({
    name: LEAD_STATUS_LABELS[status],
    value: byStatus[status],
    fill: PIPELINE_COLORS[status],
  }))

  // ── Source distribution (top 6) ─────────────────────────────────────────────
  const sourceCount = allLeads.reduce((acc, l) => {
    const src = l.source ?? 'Direto'
    acc[src] = (acc[src] ?? 0) + 1
    return acc
  }, {} as Record<string, number>)

  const sourceData = Object.entries(sourceCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([source, count]) => ({ source, count }))

  // ── Score distribution (5 bins) ─────────────────────────────────────────────
  const scoreBins = [
    { range: '0–20', count: 0 },
    { range: '21–40', count: 0 },
    { range: '41–60', count: 0 },
    { range: '61–80', count: 0 },
    { range: '81–100', count: 0 },
  ]
  allLeads.forEach((l) => {
    const bin = Math.min(Math.floor((l.score ?? 0) / 20), 4)
    scoreBins[bin].count++
  })

  // ── Agent run counts ────────────────────────────────────────────────────────
  const agentCount = allRuns.reduce((acc, r) => {
    acc[r.agent_type] = (acc[r.agent_type] ?? 0) + 1
    return acc
  }, {} as Record<string, number>)

  const agentData = Object.entries(AGENT_LABELS).map(([type, label]) => ({
    type,
    label,
    runs: agentCount[type] ?? 0,
  }))

  const chartsData: AnalyticsChartsData = { weeklyData, pipelineData, sourceData, scoreData: scoreBins, agentData }

  const kpis = [
    { label: 'Total Leads', value: total, icon: Users, color: 'text-indigo-600', bg: 'bg-indigo-50' },
    { label: 'Leads Ativas', value: active, icon: TrendingUp, color: 'text-green-600', bg: 'bg-green-50' },
    { label: 'Taxa Conversão', value: `${convRate}%`, icon: Award, color: 'text-emerald-600', bg: 'bg-emerald-50' },
    { label: 'Perdidas', value: lost, icon: XCircle, color: 'text-red-500', bg: 'bg-red-50' },
  ]

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>
        <p className="text-sm text-gray-500 mt-0.5">KPIs e métricas de performance da equipa</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((kpi) => {
          const Icon = kpi.icon
          return (
            <Card key={kpi.label}>
              <CardContent className="pt-5">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${kpi.bg}`}>
                    <Icon size={18} className={kpi.color} />
                  </div>
                  <div>
                    <div className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</div>
                    <div className="text-xs text-gray-500">{kpi.label}</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Secondary metrics */}
      <div className="grid grid-cols-3 gap-4 text-center">
        {[
          { label: 'Score Médio IA', value: `${avgScore}/100` },
          { label: 'Agente Runs', value: allRuns.length },
          { label: 'Leads Ganhas', value: won },
        ].map((m) => (
          <div key={m.label} className="bg-gray-50 rounded-xl py-4 px-3">
            <div className="text-xl font-bold text-gray-800">{m.value}</div>
            <div className="text-xs text-gray-500 mt-0.5">{m.label}</div>
          </div>
        ))}
      </div>

      {/* Charts */}
      <ChartsLoader {...chartsData} />
    </div>
  )
}
