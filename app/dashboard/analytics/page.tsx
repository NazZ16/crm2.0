import { createClient } from '@/lib/supabase/server'
import { Card, CardContent } from '@/components/ui/card'
import { LEAD_STATUS_LABELS, LEAD_PIPELINE_ORDER, type LeadStatus } from '@/lib/types'
import { Users, TrendingUp, Award, XCircle, Clock, AlertTriangle, PhoneCall } from 'lucide-react'
import type { AnalyticsChartsData } from './AnalyticsCharts'
import ChartsLoader from './ChartsLoader'

export const dynamic = 'force-dynamic'

const PIPELINE_COLORS: Record<LeadStatus, string> = {
  new: '#6366f1',
  qualified: '#8b5cf6',
  meeting: '#f59e0b',
  active: '#22c55e',
  cpcv: '#4f46e5',
  escriturado: '#0d9488',
  won: '#10b981',
  lost: '#ef4444',
}

// Cadeia sequencial do funil para % vs. estado anterior — 'lost' fica de fora
// por ser saída lateral, não um "próximo estado" na progressão normal.
const SEQUENTIAL_STATUSES: LeadStatus[] =
  ['new', 'qualified', 'meeting', 'active', 'cpcv', 'escriturado', 'won']

// Tipos de interação que contam como contacto real (alinhado com CONTACT_TYPES
// em app/api/interactions/route.ts, que decide o auto-bump new -> qualified).
const CONTACT_INTERACTION_TYPES = ['call', 'whatsapp', 'email', 'meeting'] as const

function median(nums: number[]): number | null {
  if (nums.length === 0) return null
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function formatHoursLabel(hours: number | null): string {
  if (hours === null) return '—'
  if (hours < 1) return '<1h'
  if (hours < 24) return `${Math.round(hours)}h`
  return `${(hours / 24).toFixed(1)}d`
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
  const [leadsRes, agentRunsRes, interactionsRes] = await Promise.all([
    supabase
      .from('leads')
      .select('id, status, score, urgency, source, created_at')
      .eq('team_id', member.team_id),
    supabase
      .from('agent_runs')
      .select('agent_type, status, created_at')
      .eq('team_id', member.team_id)
      .eq('status', 'done'),
    // Sem filtro de data: precisamos do 1o contacto de sempre por lead (ver abaixo)
    supabase
      .from('interactions')
      .select('lead_id, occurred_at, type')
      .eq('team_id', member.team_id)
      .in('type', CONTACT_INTERACTION_TYPES),
  ])

  const allLeads = leadsRes.data ?? []
  const allRuns = agentRunsRes.data ?? []
  const allContacts = interactionsRes.data ?? []

  // ── Top-level KPIs ──────────────────────────────────────────────────────────
  const total = allLeads.length
  const won = allLeads.filter((l) => l.status === 'won').length
  const lost = allLeads.filter((l) => l.status === 'lost').length
  const active = allLeads.filter((l) => !['won', 'lost'].includes(l.status)).length
  const convRate = total > 0 ? ((won / total) * 100).toFixed(1) : '0.0'
  const avgScore = total > 0
    ? Math.round(allLeads.reduce((s, l) => s + (l.score ?? 0), 0) / total)
    : 0

  const now = new Date()

  // ── Velocidade até ao 1o contacto + atividade de prospecção (30 dias) ───────
  const firstContactMsByLead = new Map<string, number>()
  for (const row of allContacts) {
    if (!row.lead_id) continue
    const t = new Date(row.occurred_at).getTime()
    const existing = firstContactMsByLead.get(row.lead_id)
    if (existing === undefined || t < existing) firstContactMsByLead.set(row.lead_id, t)
  }

  const contactDeltasHours: number[] = []
  for (const lead of allLeads) {
    const firstContactMs = firstContactMsByLead.get(lead.id)
    if (firstContactMs === undefined) continue
    const deltaMs = firstContactMs - new Date(lead.created_at).getTime()
    if (deltaMs < 0) continue // dados sujos (interacao registada antes da criacao da lead)
    contactDeltasHours.push(deltaMs / 3_600_000)
  }

  const avgContactHours = contactDeltasHours.length
    ? contactDeltasHours.reduce((a, b) => a + b, 0) / contactDeltasHours.length
    : null
  const medianContactHours = median(contactDeltasHours)

  const untouchedNewLeads = allLeads.filter(
    (l) => l.status === 'new' && !firstContactMsByLead.has(l.id)
  ).length

  const since30d = now.getTime() - 30 * 24 * 60 * 60 * 1000
  const contacted30dCount = new Set(
    allContacts
      .filter((r) => r.type !== 'meeting' && new Date(r.occurred_at).getTime() >= since30d)
      .map((r) => r.lead_id)
  ).size

  // ── Weekly leads (last 8 weeks) ─────────────────────────────────────────────
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

  const pipelineData = LEAD_PIPELINE_ORDER.map((status) => {
    const value = byStatus[status]
    const pctOfTotal = total > 0 ? (value / total) * 100 : null

    let pctOfPrevious: number | null = null
    const seqIdx = SEQUENTIAL_STATUSES.indexOf(status)
    if (seqIdx > 0) {
      const prevCount = byStatus[SEQUENTIAL_STATUSES[seqIdx - 1]]
      pctOfPrevious = prevCount > 0 ? (value / prevCount) * 100 : null
    }

    return { name: LEAD_STATUS_LABELS[status], status, value, fill: PIPELINE_COLORS[status], pctOfTotal, pctOfPrevious }
  })

  // ── Source distribution + win rate (top 6) ──────────────────────────────────
  const sourceStats = allLeads.reduce((acc, l) => {
    const src = l.source ?? 'Direto'
    if (!acc[src]) acc[src] = { total: 0, won: 0 }
    acc[src].total++
    if (l.status === 'won') acc[src].won++
    return acc
  }, {} as Record<string, { total: number; won: number }>)

  const sourceData = Object.entries(sourceStats)
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 6)
    .map(([source, { total: srcTotal, won: srcWon }]) => ({
      source,
      count: srcTotal,
      won: srcWon,
      winRate: srcTotal > 0 ? (srcWon / srcTotal) * 100 : 0,
    }))

  // ── Score distribution + win rate (5 bins) ──────────────────────────────────
  const scoreBins = [
    { range: '0–20', count: 0, won: 0 },
    { range: '21–40', count: 0, won: 0 },
    { range: '41–60', count: 0, won: 0 },
    { range: '61–80', count: 0, won: 0 },
    { range: '81–100', count: 0, won: 0 },
  ]
  allLeads.forEach((l) => {
    const bin = Math.min(Math.floor((l.score ?? 0) / 20), 4)
    scoreBins[bin].count++
    if (l.status === 'won') scoreBins[bin].won++
  })
  const scoreData = scoreBins.map((b) => ({
    ...b,
    winRate: b.count > 0 ? (b.won / b.count) * 100 : null,
  }))

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

  const chartsData: AnalyticsChartsData = { weeklyData, pipelineData, sourceData, scoreData, agentData }

  const kpis = [
    { label: 'Total Leads', value: total, icon: Users, color: 'text-indigo-600', bg: 'bg-indigo-50' },
    { label: 'Leads Ativas', value: active, icon: TrendingUp, color: 'text-green-600', bg: 'bg-green-50' },
    { label: 'Taxa Conversão', value: `${convRate}%`, icon: Award, color: 'text-emerald-600', bg: 'bg-emerald-50' },
    { label: 'Contactados (30d)', value: contacted30dCount, icon: PhoneCall, color: 'text-teal-600', bg: 'bg-teal-50' },
    { label: 'Perdidas', value: lost, icon: XCircle, color: 'text-red-500', bg: 'bg-red-50' },
    { label: 'Tempo médio 1º contacto', value: formatHoursLabel(avgContactHours), icon: Clock, color: 'text-amber-600', bg: 'bg-amber-50' },
    { label: 'Mediana 1º contacto', value: formatHoursLabel(medianContactHours), icon: Clock, color: 'text-orange-600', bg: 'bg-orange-50' },
    { label: 'Leads por tocar', value: untouchedNewLeads, icon: AlertTriangle, color: 'text-red-600', bg: 'bg-red-50' },
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
