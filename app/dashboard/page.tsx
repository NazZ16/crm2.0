import { createClient } from '@/lib/supabase/server'
import { LEAD_STATUS_LABELS, LEAD_PIPELINE_ORDER, type LeadStatus } from '@/lib/types'
import { formatRelativeTime, formatCurrency } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import Link from 'next/link'
import {
  Users,
  TrendingUp,
  Target,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Bot,
  ArrowRight,
} from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  // Get team_id
  const { data: memberData } = await supabase
    .from('team_members')
    .select('team_id')
    .eq('user_id', user.id)
    .single()

  if (!memberData) {
    return (
      <div className="p-8">
        <p className="text-gray-500">Equipa não encontrada. Por favor contacta o administrador.</p>
      </div>
    )
  }

  const teamId = memberData.team_id

  // Fetch all data in parallel
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

  // KPI calculations
  const totalLeads = leads.length
  const newLeads = leads.filter((l) => l.status === 'new').length
  const wonLeads = leads.filter((l) => l.status === 'won').length
  const activeLeads = leads.filter((l) => ['qualified', 'meeting', 'active'].includes(l.status)).length
  const conversionRate = totalLeads > 0 ? Math.round((wonLeads / totalLeads) * 100) : 0

  // Cold leads: no contact in 7+ days (excluding won/lost)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const coldLeads = leads.filter((l) => {
    if (['won', 'lost'].includes(l.status)) return false
    const lastContact = l.last_contact_at ? new Date(l.last_contact_at) : new Date(l.created_at)
    return lastContact < sevenDaysAgo
  })

  // Tasks due today
  const today = new Date()
  today.setHours(23, 59, 59, 999)
  const tasksDueToday = tasks.filter((t) => t.due_at && new Date(t.due_at) <= today)
  const overdueCount = tasks.filter((t) => t.due_at && new Date(t.due_at) < new Date()).length

  // Pipeline summary
  const pipelineCounts = LEAD_PIPELINE_ORDER.reduce((acc, status) => {
    acc[status] = leads.filter((l) => l.status === status).length
    return acc
  }, {} as Record<LeadStatus, number>)

  const agentTypeLabels: Record<string, string> = {
    lead: 'Agente de Leads',
    followup: 'Agente de Follow-up',
    coach: 'Coach IA',
    marketing: 'Agente Marketing',
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">
          {new Date().toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
      </div>

      {/* KPI Cards */}
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
                <p className="text-sm text-gray-500">Taxa Conversão</p>
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
        {/* Pipeline Summary */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Pipeline de Leads</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
              {LEAD_PIPELINE_ORDER.map((status) => {
                const count = pipelineCounts[status]
                const colors: Record<LeadStatus, string> = {
                  new: 'bg-blue-500',
                  qualified: 'bg-purple-500',
                  meeting: 'bg-yellow-500',
                  active: 'bg-green-500',
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

        {/* Agent Activity */}
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
        {/* Tasks Today */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock size={16} />
              Tarefas para Hoje
              {overdueCount > 0 && (
                <Badge variant="destructive" className="text-xs">{overdueCount} atrasadas</Badge>
              )}
            </CardTitle>
            <Link href="/dashboard/leads" className="text-xs text-blue-600 hover:underline flex items-center gap-1">
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
                    <div
                      key={task.id}
                      className={`flex items-start gap-3 p-2.5 rounded-lg border-l-4 bg-gray-50 ${priorityColors[task.priority]}`}
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
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Cold Leads Alert */}
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
                <p className="text-sm text-gray-400">Sem leads frias. Ótimo trabalho!</p>
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
                        <p className="text-xs text-red-500">Sem contacto há {daysSince} dias</p>
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
