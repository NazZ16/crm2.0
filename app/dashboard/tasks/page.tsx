import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CheckSquare2, AlertTriangle, Calendar, Clock, Inbox } from 'lucide-react'
import { TasksClient } from './TasksClient'

export const dynamic = 'force-dynamic'

export interface TaskRow {
  id: string
  title: string
  description: string | null
  status: 'open' | 'done'
  priority: 'low' | 'medium' | 'high' | 'urgent'
  due_at: string | null
  created_at: string
  created_by: 'agent' | 'user' | null
  lead_id: string
  lead_name: string
  lead_phone: string | null
}

function startOfDay(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

function endOfDay(date: Date): Date {
  const d = new Date(date)
  d.setHours(23, 59, 59, 999)
  return d
}

export default async function TasksPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: member } = await supabase
    .from('team_members')
    .select('team_id, role')
    .eq('user_id', user.id)
    .single()
  if (!member) return null

  const now = new Date()
  const startOfToday = startOfDay(now).toISOString()
  const endOfToday = endOfDay(now).toISOString()

  // Tarefas abertas + concluidas nas ultimas 24h (para feedback visual)
  const { data: rawTasks } = await supabase
    .from('tasks')
    .select(`
      id, title, description, status, priority, due_at, created_at, created_by,
      lead_id,
      leads ( id, full_name, phone )
    `)
    .eq('team_id', member.team_id)
    .or(`status.eq.open,and(status.eq.done,updated_at.gte.${startOfToday})`)
    .order('due_at', { ascending: true, nullsFirst: false })
    .limit(200)

  type LeadJoin = { id: string; full_name: string; phone: string | null } | null
  const allTasks: TaskRow[] = (rawTasks ?? []).map((t) => {
    const leadObj = (Array.isArray(t.leads) ? t.leads[0] : t.leads) as LeadJoin
    return {
      id: t.id,
      title: t.title,
      description: t.description,
      status: t.status as 'open' | 'done',
      priority: t.priority as 'low' | 'medium' | 'high' | 'urgent',
      due_at: t.due_at,
      created_at: t.created_at,
      created_by: t.created_by as 'agent' | 'user' | null,
      lead_id: t.lead_id,
      lead_name: leadObj?.full_name ?? 'Lead sem nome',
      lead_phone: leadObj?.phone ?? null,
    }
  })

  const open = allTasks.filter((t) => t.status === 'open')
  const doneToday = allTasks.filter((t) => t.status === 'done')

  const overdue = open.filter((t) => t.due_at && new Date(t.due_at) < startOfDay(now))
  const today = open.filter(
    (t) => t.due_at && new Date(t.due_at) >= startOfDay(now) && new Date(t.due_at) <= endOfDay(now)
  )
  const upcoming = open.filter((t) => t.due_at && new Date(t.due_at) > endOfDay(now))
  const noDue = open.filter((t) => !t.due_at)

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Tarefas</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {open.length} tarefa{open.length === 1 ? '' : 's'} abertas
          {doneToday.length > 0 && ` - ${doneToday.length} concluida${doneToday.length === 1 ? '' : 's'} hoje`}
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          icon={<AlertTriangle size={18} className="text-red-500" />}
          label="Atrasadas"
          value={overdue.length}
          accent="text-red-600"
        />
        <StatCard
          icon={<Calendar size={18} className="text-blue-500" />}
          label="Hoje"
          value={today.length}
          accent="text-blue-600"
        />
        <StatCard
          icon={<Clock size={18} className="text-gray-400" />}
          label="Proximas"
          value={upcoming.length}
          accent="text-gray-700"
        />
        <StatCard
          icon={<CheckSquare2 size={18} className="text-green-500" />}
          label="Feitas hoje"
          value={doneToday.length}
          accent="text-green-600"
        />
      </div>

      {open.length === 0 && doneToday.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <Inbox size={40} className="mx-auto text-gray-200 mb-2" />
            <p className="text-sm text-gray-500">Sem tarefas no momento</p>
            <p className="text-xs text-gray-400 mt-1">
              Corre o "Plano de Follow-up" em Agentes IA para gerar tarefas automaticas
            </p>
          </CardContent>
        </Card>
      )}

      {overdue.length > 0 && (
        <Section title="Atrasadas" icon={<AlertTriangle size={16} className="text-red-500" />} accent="border-red-200">
          <TasksClient tasks={overdue} />
        </Section>
      )}

      {today.length > 0 && (
        <Section title="Hoje" icon={<Calendar size={16} className="text-blue-500" />} accent="border-blue-200">
          <TasksClient tasks={today} />
        </Section>
      )}

      {upcoming.length > 0 && (
        <Section title="Proximas" icon={<Clock size={16} className="text-gray-400" />}>
          <TasksClient tasks={upcoming} />
        </Section>
      )}

      {noDue.length > 0 && (
        <Section title="Sem prazo" icon={<Inbox size={16} className="text-gray-400" />}>
          <TasksClient tasks={noDue} />
        </Section>
      )}

      {doneToday.length > 0 && (
        <Section title="Concluidas hoje" icon={<CheckSquare2 size={16} className="text-green-500" />} accent="border-green-100">
          <TasksClient tasks={doneToday} />
        </Section>
      )}
    </div>
  )
}

function StatCard({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode
  label: string
  value: number
  accent: string
}) {
  return (
    <Card>
      <CardContent className="pt-5 pb-5">
        <div className="flex items-center gap-3">
          {icon}
          <div>
            <div className={`text-2xl font-bold ${accent}`}>{value}</div>
            <div className="text-xs text-gray-500">{label}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function Section({
  title,
  icon,
  accent,
  children,
}: {
  title: string
  icon: React.ReactNode
  accent?: string
  children: React.ReactNode
}) {
  return (
    <Card className={accent ?? ''}>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold text-gray-700 uppercase tracking-wide flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}
