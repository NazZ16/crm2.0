import { createClient } from '@/lib/supabase/server'
import { LEAD_STATUS_LABELS, LEAD_PIPELINE_ORDER, type LeadStatus } from '@/lib/types'
import { formatRelativeTime } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import Link from 'next/link'
import { Suspense } from 'react'
import {
  Users,
  TrendingUp,
  Target,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Bot,
  ArrowRight,
  Trophy,
  CalendarDays,
} from 'lucide-react'
import { orientatorAgent } from '@/lib/agents/orientator-agent'
import { listTodaysEvents, isCrmCreatedEvent, type GoogleCalendarEvent } from '@/lib/google-calendar'
import { YEARLY_REVENUE_TARGET_EUR, PIPELINE_PROBABILITIES } from '@/lib/business-constants'

export const dynamic = 'force-dynamic'

function fmtEur(v: number): string {
  return new Intl.NumberFormat('pt-PT', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(v)
}

const COMMISSION_DEFAULT_RATE = 0.04 // fallback quando lead so tem deal_value

async function RevenueCard({ teamId }: { teamId: string }) {
  const supabase = await createClient()
  const now = new Date()
  const year = now.getFullYear()
  const startOfYear = new Date(year, 0, 1).toISOString()
  const startOfNextYear = new Date(year + 1, 0, 1).toISOString()
  const startOfMonth = new Date(year, now.getMonth(), 1).toISOString()

  const [closedRes, openRes] = await Promise.all([
    supabase
      .from('leads')
      .select('id, full_name, commission_value, deal_value, closed_at')
      .eq('team_id', teamId)
      .eq('status', 'won')
      .not('closed_at', 'is', null)
      .gte('closed_at', startOfYear)
      .lt('closed_at', startOfNextYear)
      .order('closed_at', { ascending: false }),
    supabase
      .from('leads')
      .select('id, status, commission_value, deal_value')
      .eq('team_id', teamId)
      .in('status', ['qualified', 'meeting', 'active']),
  ])

  const all = (closedRes.data ?? []) as {
    id: string
    full_name: string
    commission_value: number | null
    deal_value: number | null
    closed_at: string | null
  }[]

  const openLeads = (openRes.data ?? []) as {
    id: string
    status: string
    commission_value: number | null
    deal_value: number | null
  }[]

  const totalYtd = all.reduce((sum, l) => sum + (l.commission_value ?? 0), 0)
  const monthLeads = all.filter((l) => l.closed_at && l.closed_at >= startOfMonth)
  const totalMonth = monthLeads.reduce((sum, l) => sum + (l.commission_value ?? 0), 0)
  const dealsCount = all.length

  // Forecast ponderado: para cada lead em pipeline, valor (comissao real ou estimada) * P(fecho).
  let forecastWeighted = 0
  let forecastGross = 0
  let forecastDealsCount = 0
  for (const l of openLeads) {
    const value = l.commission_value ?? (l.deal_value != null ? l.deal_value * COMMISSION_DEFAULT_RATE : null)
    if (value == null || value <= 0) continue
    const p = PIPELINE_PROBABILITIES[l.status] ?? 0
    forecastWeighted += value * p
    forecastGross += value
    forecastDealsCount += 1
  }

  const target = YEARLY_REVENUE_TARGET_EUR
  const pct = target > 0 ? Math.min(100, Math.round((totalYtd / target) * 100)) : 0
  const remaining = Math.max(0, target - totalYtd)

  const dayOfYear = Math.floor((now.getTime() - new Date(year, 0, 1).getTime()) / 86400000) + 1
  const daysInYear = ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0) ? 366 : 365
  const expectedYtd = (target * dayOfYear) / daysInYear
  const onPace = totalYtd >= expectedYtd
  const paceDelta = totalYtd - expectedYtd

  // Projeccao: YTD ja fechado + forecast ponderado >= target?
  const projectedTotal = totalYtd + forecastWeighted
  const willHitTarget = projectedTotal >= target
  const projectedShortfall = Math.max(0, target - projectedTotal)

  return (
    <Card className="border-emerald-100 bg-gradient-to-br from-emerald-50 via-white to-white">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Trophy size={18} className="text-emerald-600" />
          Faturacao {year}
        </CardTitle>
        <span className="text-xs text-gray-500">
          {dealsCount} deal{dealsCount === 1 ? '' : 's'} fechada{dealsCount === 1 ? '' : 's'}
        </span>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div>
            <div className="text-3xl font-bold text-gray-900">{fmtEur(totalYtd)}</div>
            <div className="text-xs text-gray-500 mt-0.5">de {fmtEur(target)} ({pct}%)</div>
          </div>
          <div className="text-right">
            <div className="text-sm font-semibold text-gray-700">{fmtEur(totalMonth)}</div>
            <div className="text-xs text-gray-500">este mes</div>
          </div>
        </div>

        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-emerald-400 to-emerald-600 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>

        <div className="flex items-center justify-between text-xs">
          <span className={onPace ? 'text-emerald-600 font-medium' : 'text-orange-600 font-medium'}>
            {onPace ? '+' : ''}{fmtEur(Math.abs(paceDelta))} {onPace ? 'acima' : 'abaixo'} do ritmo linear
          </span>
          <span className="text-gray-500">faltam {fmtEur(remaining)}</span>
        </div>

        {/* Forecast ponderado: pipeline em qualified/meeting/active * P(fecho) */}
        {forecastDealsCount > 0 && (
          <div className="pt-2 border-t border-emerald-100/70 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-gray-600">Pipeline ponderado</span>
              <span className="font-semibold text-gray-800 tabular-nums" title={`${forecastDealsCount} deal${forecastDealsCount === 1 ? '' : 's'} abertas, valor bruto ${fmtEur(forecastGross)}`}>
                {fmtEur(forecastWeighted)}
              </span>
            </div>
            <div className={`flex items-center justify-between text-xs ${willHitTarget ? 'text-emerald-600' : 'text-orange-600'}`}>
              <span>
                {willHitTarget
                  ? `Projeccao: cumpres os ${fmtEur(target)} ✓`
                  : `Projeccao: faltariam ${fmtEur(projectedShortfall)}`}
              </span>
              <span className="text-gray-400 font-normal" title="qualified=10%, meeting=30%, active=60%">
                {forecastDealsCount} aberta{forecastDealsCount === 1 ? '' : 's'}
              </span>
            </div>
          </div>
        )}

        {monthLeads.length > 0 && (
          <div className="pt-2 border-t border-emerald-100/70">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Fechadas este mes</p>
            <ul className="space-y-1">
              {monthLeads.slice(0, 4).map((l) => (
                <li key={l.id} className="flex items-center justify-between text-xs">
                  <Link href={`/dashboard/leads/${l.id}`} className="text-gray-700 hover:text-emerald-700 truncate">
                    {l.full_name}
                  </Link>
                  <span className="font-medium text-emerald-700 ml-2">
                    {fmtEur(l.commission_value ?? 0)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

async function TodayCalendarCard({ teamId }: { teamId: string }) {
  let events: GoogleCalendarEvent[] = []
  try {
    events = await listTodaysEvents(teamId)
  } catch {
    return null
  }

  // Filtra eventos criados pelo proprio CRM (a partir de tasks) — esses ja
  // aparecem no card "Tarefas para Hoje", evita duplicacao.
  events = events.filter((ev) => !isCrmCreatedEvent(ev))

  // Sem conexao Google ou sem eventos hoje — nao mostra o card.
  if (events.length === 0) return null

  function fmtTime(ev: GoogleCalendarEvent): string {
    if (ev.start.dateTime) {
      const d = new Date(ev.start.dateTime)
      return d.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })
    }
    if (ev.start.date) return 'Dia inteiro'
    return ''
  }

  function fmtRange(ev: GoogleCalendarEvent): string {
    if (ev.start.dateTime && ev.end.dateTime) {
      const s = new Date(ev.start.dateTime).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })
      const e = new Date(ev.end.dateTime).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })
      return `${s} – ${e}`
    }
    return fmtTime(ev)
  }

  return (
    <Card className="border-indigo-100 bg-gradient-to-br from-indigo-50/50 to-white">
      <CardHeader className="flex flex-row items-center gap-2 pb-3">
        <div className="p-2 bg-indigo-100 rounded-full">
          <CalendarDays size={18} className="text-indigo-600" />
        </div>
        <CardTitle className="text-base">Agenda Google de hoje</CardTitle>
        <span className="ml-auto text-xs text-gray-500">{events.length} evento{events.length === 1 ? '' : 's'}</span>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {events.map((ev) => {
            const meetLink = ev.hangoutLink ?? ev.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video')?.uri
            return (
              <li key={ev.id} className="flex items-start gap-3 p-2.5 rounded-lg bg-white border border-indigo-100">
                <div className="flex flex-col items-center text-xs text-indigo-700 font-semibold tabular-nums min-w-[70px]">
                  <span>{fmtRange(ev)}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <a
                    href={ev.htmlLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium text-gray-800 hover:text-indigo-700 truncate block"
                  >
                    {ev.summary ?? '(sem titulo)'}
                  </a>
                  {ev.location && <p className="text-xs text-gray-500 truncate">{ev.location}</p>}
                  {meetLink && (
                    <a href={meetLink} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">
                      Entrar na reuniao
                    </a>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}

async function OrientatorCard({ teamId }: { teamId: string }) {
  try {
    const supabase = await createClient()
    const now = new Date()

    const twelveHoursAgo = new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString()
    const { data: cachedRun } = await supabase
      .from('agent_runs')
      .select('output_json')
      .eq('team_id', teamId)
      .eq('agent_type', 'orientator')
      .eq('status', 'done')
      .gte('created_at', twelveHoursAgo)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    type Briefing = {
      urgentes: { lead_name: string; lead_id: string; razao: string; acao: string }[]
      esta_semana: { item: string; detalhe: string }[]
      coach_insight: string | null
    }

    let briefing: Briefing | null = null
    if (cachedRun?.output_json) {
      const o = cachedRun.output_json as Briefing
      if (Array.isArray(o.urgentes) && Array.isArray(o.esta_semana)) {
        briefing = o
      }
    }

    if (!briefing) {
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
      const endOfToday = new Date(now)
      endOfToday.setHours(23, 59, 59, 999)

      const [urgentLeadsRes, tasksTodayRes, coldLeadsRes, matchesRes, learningRes] = await Promise.all([
        supabase
          .from('leads')
          .select('id, full_name, score, urgency, last_contact_at')
          .eq('team_id', teamId)
          .not('status', 'in', '(won,lost)')
          .or('urgency.gte.3,score.gte.70')
          .order('urgency', { ascending: false })
          .limit(5),

        supabase
          .from('tasks')
          .select('title, lead_id')
          .eq('team_id', teamId)
          .eq('status', 'open')
          .lte('due_at', endOfToday.toISOString())
          .limit(5),

        supabase
          .from('leads')
          .select('id', { count: 'exact', head: true })
          .eq('team_id', teamId)
          .not('status', 'in', '(won,lost)')
          .lt('last_contact_at', sevenDaysAgo),

        supabase
          .from('investor_matches')
          .select('id', { count: 'exact', head: true })
          .eq('team_id', teamId)
          .in('status', ['suggested', 'presented']),

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

      const startMs = Date.now()
      briefing = await orientatorAgent.generateBriefing({
        urgentLeads,
        tasksDueToday,
        coldLeadsCount,
        openMatchesCount,
        coachLearning,
      })

      await supabase.from('agent_runs').insert({
        team_id: teamId,
        agent_type: 'orientator',
        trigger_type: 'auto',
        input_summary: 'Briefing diario - foco do dia',
        status: 'done',
        output_json: briefing,
        duration_ms: Date.now() - startMs,
      })
    }

    return (
      <Card className="border-blue-100 bg-gradient-to-br from-blue-50 to-white">
        <CardHeader className="flex flex-row items-center gap-2 pb-3">
          <div className="p-2 bg-blue-100 rounded-full">
            <Bot size={18} className="text-blue-600" />
          </div>
          <CardTitle className="text-base">O teu foco hoje</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {briefing.urgentes.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-red-600 uppercase tracking-wide mb-2">Urgente</p>
              <div className="space-y-2">
                {briefing.urgentes.map((u, i) => (
                  <Link
                    key={i}
                    href={`/dashboard/leads/${u.lead_id}`}
                    className="flex flex-col gap-0.5 p-2.5 rounded-lg bg-red-50 hover:bg-red-100 transition-colors"
                  >
                    <p className="text-sm font-medium text-gray-800">{u.lead_name}</p>
                    <p className="text-xs text-red-600">{u.razao}</p>
                    <p className="text-xs text-gray-500">{u.acao}</p>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {briefing.esta_semana.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-yellow-600 uppercase tracking-wide mb-2">Esta semana</p>
              <div className="space-y-2">
                {briefing.esta_semana.map((e, i) => (
                  <div key={i} className="p-2.5 rounded-lg bg-yellow-50">
                    <p className="text-sm font-medium text-gray-800">{e.item}</p>
                    <p className="text-xs text-gray-500">{e.detalhe}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {briefing.coach_insight && (
            <div className="p-3 rounded-lg bg-purple-50 border border-purple-100">
              <p className="text-xs font-semibold text-purple-600 uppercase tracking-wide mb-1">Coach IA</p>
              <p className="text-sm text-gray-700">{briefing.coach_insight}</p>
            </div>
          )}
        </CardContent>
      </Card>
    )
  } catch {
    return null
  }
}

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: memberData } = await supabase
    .from('team_members')
    .select('team_id')
    .eq('user_id', user.id)
    .single()

  if (!memberData) {
    return (
      <div className="p-8">
        <p className="text-gray-500">Equipa nao encontrada. Por favor contacta o administrador.</p>
      </div>
    )
  }

  const teamId = memberData.team_id

  const [leadsRes, tasksRes, agentRunsRes] = await Promise.all([
    supabase
      .from('leads')
      .select('id, status, score, urgency, full_name, last_contact_at, created_at, assigned_to')
      .eq('team_id', teamId)
      .order('created_at', { ascending: false }),
    supabase
      .from('tasks')
      .select('id, title, status, priority, due_at, lead_id, created_by')
      .eq('team_id', teamId)
      .eq('status', 'open')
      .order('due_at', { ascending: true })
      .limit(10),
    supabase
      .from('agent_runs')
      .select('id, agent_type, status, created_at, lead_id, input_summary')
      .eq('team_id', teamId)
      .order('created_at', { ascending: false })
      .limit(8),
  ])

  const leads = leadsRes.data ?? []
  const tasks = tasksRes.data ?? []
  const agentRuns = agentRunsRes.data ?? []

  const totalLeads = leads.length
  const newLeads = leads.filter((l) => l.status === 'new').length
  const wonLeads = leads.filter((l) => l.status === 'won').length
  const activeLeads = leads.filter((l) => ['qualified', 'meeting', 'active'].includes(l.status)).length
  const conversionRate = totalLeads > 0 ? Math.round((wonLeads / totalLeads) * 100) : 0

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const coldLeads = leads.filter((l) => {
    if (['won', 'lost'].includes(l.status)) return false
    const lastContact = l.last_contact_at ? new Date(l.last_contact_at) : new Date(l.created_at)
    return lastContact < sevenDaysAgo
  })

  const today = new Date()
  today.setHours(23, 59, 59, 999)
  const tasksDueToday = tasks.filter((t) => t.due_at && new Date(t.due_at) <= today)
  const overdueCount = tasks.filter((t) => t.due_at && new Date(t.due_at) < new Date()).length

  const pipelineCounts = LEAD_PIPELINE_ORDER.reduce((acc, status) => {
    acc[status] = leads.filter((l) => l.status === status).length
    return acc
  }, {} as Record<LeadStatus, number>)

  const agentTypeLabels: Record<string, string> = {
    lead: 'Agente de Leads',
    followup: 'Agente de Follow-up',
    coach: 'Coach IA',
    marketing: 'Agente Marketing',
    orientator: 'Orientador',
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">
          {new Date().toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
      </div>

      <Suspense fallback={null}>
        <RevenueCard teamId={teamId} />
      </Suspense>

      <Suspense fallback={null}>
        <TodayCalendarCard teamId={teamId} />
      </Suspense>

      <Suspense fallback={null}>
        <OrientatorCard teamId={teamId} />
      </Suspense>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Total Leads</p>
                <p className="text-3xl font-bold mt-1">{totalLeads}</p>
                <p className="text-xs text-gray-500 mt-1">{newLeads} novas esta semana</p>
              </div>
              <div className="p-3 bg-blue-50 rounded-full">
                <Users size={22} className="text-blue-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Em Pipeline</p>
                <p className="text-3xl font-bold mt-1">{activeLeads}</p>
                <p className="text-xs text-gray-500 mt-1">leads ativas</p>
              </div>
              <div className="p-3 bg-green-50 rounded-full">
                <TrendingUp size={22} className="text-green-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Taxa Conversao</p>
                <p className="text-3xl font-bold mt-1">{conversionRate}%</p>
                <p className="text-xs text-gray-500 mt-1">{wonLeads} ganhos</p>
              </div>
              <div className="p-3 bg-purple-50 rounded-full">
                <Target size={22} className="text-purple-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Leads Frias</p>
                <p className={`text-3xl font-bold mt-1 ${coldLeads.length > 0 ? 'text-red-600' : ''}`}>
                  {coldLeads.length}
                </p>
                <p className="text-xs text-gray-500 mt-1">sem contacto &gt;7 dias</p>
              </div>
              <div className={`p-3 rounded-full ${coldLeads.length > 0 ? 'bg-red-50' : 'bg-gray-50'}`}>
                <AlertTriangle size={22} className={coldLeads.length > 0 ? 'text-red-500' : 'text-gray-400'} />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Pipeline de Leads</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-4 md:grid-cols-8 gap-3">
              {LEAD_PIPELINE_ORDER.map((status) => {
                const count = pipelineCounts[status]
                const colors: Record<LeadStatus, string> = {
                  new: 'bg-blue-500',
                  qualified: 'bg-purple-500',
                  meeting: 'bg-yellow-500',
                  active: 'bg-green-500',
                  cpcv: 'bg-indigo-600',
                  escriturado: 'bg-teal-600',
                  won: 'bg-emerald-500',
                  lost: 'bg-red-400',
                }
                return (
                  <Link
                    key={status}
                    href={`/dashboard/leads?status=${status}`}
                    className="text-center p-3 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors"
                  >
                    <div className={`w-2 h-2 rounded-full mx-auto mb-2 ${colors[status]}`} />
                    <div className="text-xl font-bold">{count}</div>
                    <div className="text-xs text-gray-500">{LEAD_STATUS_LABELS[status]}</div>
                  </Link>
                )
              })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Atividade dos Agentes</CardTitle>
            <Link href="/dashboard/agents" className="text-xs text-blue-600 hover:underline flex items-center gap-1">
              Ver tudo <ArrowRight size={12} />
            </Link>
          </CardHeader>
          <CardContent>
            {agentRuns.length === 0 ? (
              <div className="text-center py-4">
                <Bot size={32} className="mx-auto text-gray-300 mb-2" />
                <p className="text-sm text-gray-400">Sem actividade recente</p>
              </div>
            ) : (
              <div className="space-y-3">
                {agentRuns.slice(0, 5).map((run) => (
                  <div key={run.id} className="flex items-start gap-3">
                    <div className={`mt-0.5 w-2 h-2 rounded-full flex-shrink-0 ${
                      run.status === 'done' ? 'bg-green-500' :
                      run.status === 'failed' ? 'bg-red-500' : 'bg-yellow-500'
                    }`} />
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-gray-700 truncate">
                        {agentTypeLabels[run.agent_type] ?? run.agent_type}
                      </p>
                      {run.input_summary && (
                        <p className="text-xs text-gray-400 truncate">{run.input_summary}</p>
                      )}
                      <p className="text-xs text-gray-500">{formatRelativeTime(run.created_at)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock size={16} />
              Tarefas para Hoje
              {overdueCount > 0 && (
                <Badge variant="destructive" className="text-xs">{overdueCount} atrasadas</Badge>
              )}
            </CardTitle>
            <Link href="/dashboard/tasks" className="text-xs text-blue-600 hover:underline flex items-center gap-1">
              Ver todas <ArrowRight size={12} />
            </Link>
          </CardHeader>
          <CardContent>
            {tasksDueToday.length === 0 ? (
              <div className="text-center py-6">
                <CheckCircle2 size={32} className="mx-auto text-gray-200 mb-2" />
                <p className="text-sm text-gray-400">Sem tarefas para hoje</p>
              </div>
            ) : (
              <div className="space-y-2">
                {tasksDueToday.slice(0, 6).map((task) => {
                  const isOverdue = task.due_at && new Date(task.due_at) < new Date()
                  const priorityColors: Record<string, string> = {
                    urgent: 'border-red-400',
                    high: 'border-orange-400',
                    medium: 'border-blue-300',
                    low: 'border-gray-200',
                  }
                  return (
                    <Link
                      key={task.id}
                      href={task.lead_id ? `/dashboard/leads/${task.lead_id}` : '/dashboard/tasks'}
                      className={`flex items-start gap-3 p-2.5 rounded-lg border-l-4 bg-gray-50 hover:bg-gray-100 transition-colors ${priorityColors[task.priority]}`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-800 truncate">{task.title}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          {isOverdue && (
                            <span className="text-xs text-red-500 font-medium">Atrasada</span>
                          )}
                          {task.due_at && (
                            <span className="text-xs text-gray-400">
                              {formatRelativeTime(task.due_at)}
                            </span>
                          )}
                          {task.created_by === 'agent' && (
                            <span className="flex items-center gap-1 text-xs text-purple-500">
                              <Bot size={11} />
                              Agente
                            </span>
                          )}
                        </div>
                      </div>
                    </Link>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle size={16} className={coldLeads.length > 0 ? 'text-red-500' : 'text-gray-400'} />
              Leads Frias
            </CardTitle>
            {coldLeads.length > 0 && (
              <Link href="/dashboard/leads" className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                Ver todas <ArrowRight size={12} />
              </Link>
            )}
          </CardHeader>
          <CardContent>
            {coldLeads.length === 0 ? (
              <div className="text-center py-6">
                <CheckCircle2 size={32} className="mx-auto text-gray-200 mb-2" />
                <p className="text-sm text-gray-400">Sem leads frias. Otimo trabalho!</p>
              </div>
            ) : (
              <div className="space-y-2">
                {coldLeads.slice(0, 6).map((lead) => {
                  const lastContact = lead.last_contact_at ?? lead.created_at
                  const daysSince = Math.floor((Date.now() - new Date(lastContact).getTime()) / (1000 * 60 * 60 * 24))
                  return (
                    <Link
                      key={lead.id}
                      href={`/dashboard/leads/${lead.id}`}
                      className="flex items-center gap-3 p-2.5 rounded-lg bg-red-50 hover:bg-red-100 transition-colors"
                    >
                      <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center text-sm font-medium text-red-600">
                        {lead.full_name[0]}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-800 truncate">{lead.full_name}</p>
                        <p className="text-xs text-red-500">Sem contacto ha {daysSince} dias</p>
                      </div>
                      <ArrowRight size={14} className="text-gray-400 flex-shrink-0" />
                    </Link>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
