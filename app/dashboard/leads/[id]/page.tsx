import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { LEAD_STATUS_LABELS, LEAD_STATUS_COLORS, TASK_PRIORITY_COLORS, TASK_PRIORITY_LABELS, INTERACTION_TYPE_LABELS } from '@/lib/types'
import { formatDateTime, formatRelativeTime, formatCurrency, getInitials } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { LeadDetailClient } from './LeadDetailClient'
import {
  Phone, Mail, Calendar, Clock, ArrowLeft,
  MessageCircle, Target, AlertTriangle, CheckCircle2,
} from 'lucide-react'
import Link from 'next/link'
import type { LeadStatus, TaskPriority, InteractionType } from '@/lib/types'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

export default async function LeadDetailPage({ params }: Props) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: member } = await supabase
    .from('team_members')
    .select('team_id, role')
    .eq('user_id', user.id)
    .single()

  if (!member) return null

  // Fetch lead with all related data
  const { data: lead, error } = await supabase
    .from('leads')
    .select(`
      *,
      lead_profiles(*),
      interactions(id, type, summary, raw_text, occurred_at, created_at),
      tasks(id, title, description, status, priority, due_at, created_by, assigned_to)
    `)
    .eq('id', id)
    .eq('team_id', member.team_id)
    .order('occurred_at', { foreignTable: 'interactions', ascending: false })
    .order('due_at', { foreignTable: 'tasks', ascending: true })
    .single()

  if (error || !lead) notFound()

  const profile = Array.isArray(lead.lead_profiles) ? lead.lead_profiles[0] : lead.lead_profiles
  const interactions = Array.isArray(lead.interactions) ? lead.interactions : []
  const tasks = Array.isArray(lead.tasks) ? lead.tasks : []
  const openTasks = tasks.filter((t: { status: string }) => t.status === 'open')
  const doneTasks = tasks.filter((t: { status: string }) => t.status === 'done')

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Breadcrumb */}
      <Link href="/dashboard/leads" className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1">
        <ArrowLeft size={14} />
        Voltar às leads
      </Link>

      {/* Lead Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div className="flex items-center gap-4">
          <Avatar className="h-14 w-14">
            <AvatarFallback className="bg-blue-100 text-blue-700 text-lg font-bold">
              {getInitials(lead.full_name)}
            </AvatarFallback>
          </Avatar>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{lead.full_name}</h1>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <Badge className={LEAD_STATUS_COLORS[lead.status as LeadStatus]}>
                {LEAD_STATUS_LABELS[lead.status as LeadStatus]}
              </Badge>
              <span className="text-sm text-gray-500">Score: <strong>{lead.score}/100</strong></span>
              <span className="text-sm text-gray-500">Urgência: <strong>{lead.urgency}/5</strong></span>
              {lead.source && (
                <span className="text-xs bg-gray-100 px-2 py-0.5 rounded">{lead.source}</span>
              )}
            </div>
          </div>
        </div>

        {/* Action buttons (client component) */}
        <LeadDetailClient
          leadId={lead.id}
          leadName={lead.full_name}
          currentStatus={lead.status as LeadStatus}
          canEdit={member.role !== 'viewer'}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Contact info + Profile */}
        <div className="space-y-4">
          {/* Contact */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Contacto</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {lead.phone && (
                <a href={`tel:${lead.phone}`} className="flex items-center gap-2 text-sm text-gray-700 hover:text-blue-600">
                  <Phone size={14} className="text-gray-400" />
                  {lead.phone}
                </a>
              )}
              {lead.email && (
                <a href={`mailto:${lead.email}`} className="flex items-center gap-2 text-sm text-gray-700 hover:text-blue-600">
                  <Mail size={14} className="text-gray-400" />
                  {lead.email}
                </a>
              )}
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <Calendar size={14} className="text-gray-400" />
                Criada {formatRelativeTime(lead.created_at)}
              </div>
              {lead.last_contact_at && (
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <Clock size={14} className="text-gray-400" />
                  Último contacto {formatRelativeTime(lead.last_contact_at)}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Profile Summary */}
          {profile && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
                  Perfil IA
                  {profile.confidence_score != null && (
                    <span className="ml-2 font-normal text-gray-400 normal-case">
                      ({profile.confidence_score}% confiança)
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {profile.summary && (
                  <p className="text-gray-600 leading-relaxed">{profile.summary}</p>
                )}
                {profile.home_preferences?.zonas && profile.home_preferences.zonas.length > 0 && (
                  <div>
                    <span className="font-medium text-gray-700">Zonas: </span>
                    <span className="text-gray-600">{profile.home_preferences.zonas.join(', ')}</span>
                  </div>
                )}
                {profile.home_preferences?.tipologia && (
                  <div>
                    <span className="font-medium text-gray-700">Tipologia: </span>
                    <span className="text-gray-600">{profile.home_preferences.tipologia}</span>
                  </div>
                )}
                {profile.financial_profile?.orcamento_max && (
                  <div>
                    <span className="font-medium text-gray-700">Orçamento: </span>
                    <span className="text-gray-600">{formatCurrency(profile.financial_profile.orcamento_max)}</span>
                  </div>
                )}
                {profile.family_context?.prazo_mudanca && (
                  <div>
                    <span className="font-medium text-gray-700">Prazo: </span>
                    <span className="text-gray-600">{profile.family_context.prazo_mudanca}</span>
                  </div>
                )}
                {profile.fears_objections?.lista && profile.fears_objections.lista.length > 0 && (
                  <div>
                    <div className="font-medium text-gray-700 mb-1 flex items-center gap-1">
                      <AlertTriangle size={12} className="text-orange-400" />
                      Objeções:
                    </div>
                    <ul className="list-disc list-inside space-y-0.5">
                      {profile.fears_objections.lista.map((obj: string, i: number) => (
                        <li key={i} className="text-gray-600 text-xs">{obj}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Notes */}
          {lead.notes && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Notas</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-gray-600 leading-relaxed">{lead.notes}</p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Middle + Right: Tasks + Interactions */}
        <div className="lg:col-span-2 space-y-6">
          {/* Tasks */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
                Tarefas
                {openTasks.length > 0 && (
                  <Badge className="ml-2 bg-blue-100 text-blue-700 font-normal">{openTasks.length}</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {openTasks.length === 0 && doneTasks.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-3">Sem tarefas</p>
              ) : (
                <>
                  {openTasks.map((task: {
                    id: string; title: string; description?: string; priority: string;
                    due_at?: string; created_by: string; status: string
                  }) => {
                    const isOverdue = task.due_at && new Date(task.due_at) < new Date()
                    return (
                      <div key={task.id} className="flex items-start gap-3 p-3 rounded-lg bg-gray-50">
                        <Target size={16} className="mt-0.5 text-gray-400 flex-shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-medium text-gray-800">{task.title}</p>
                            <Badge className={`text-xs ${TASK_PRIORITY_COLORS[task.priority as TaskPriority]}`}>
                              {TASK_PRIORITY_LABELS[task.priority as TaskPriority]}
                            </Badge>
                            {task.created_by === 'agent' && (
                              <span className="text-xs text-purple-500">🤖</span>
                            )}
                          </div>
                          {task.description && (
                            <p className="text-xs text-gray-500 mt-0.5">{task.description}</p>
                          )}
                          {task.due_at && (
                            <p className={`text-xs mt-1 ${isOverdue ? 'text-red-500 font-medium' : 'text-gray-400'}`}>
                              {isOverdue ? '⚠️ ' : ''}{formatDateTime(task.due_at)}
                            </p>
                          )}
                        </div>
                      </div>
                    )
                  })}
                  {doneTasks.length > 0 && (
                    <div className="pt-1">
                      <p className="text-xs text-gray-400 mb-2">Concluídas ({doneTasks.length})</p>
                      {doneTasks.slice(0, 3).map((task: { id: string; title: string }) => (
                        <div key={task.id} className="flex items-center gap-2 py-1">
                          <CheckCircle2 size={14} className="text-green-500 flex-shrink-0" />
                          <p className="text-sm text-gray-400 line-through">{task.title}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {/* Interaction Timeline */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
                Histórico de Interações
                <span className="ml-2 font-normal text-gray-400 normal-case">({interactions.length})</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {interactions.length === 0 ? (
                <div className="text-center py-6">
                  <MessageCircle size={32} className="mx-auto text-gray-200 mb-2" />
                  <p className="text-sm text-gray-400">Sem interações registadas</p>
                  <p className="text-xs text-gray-300 mt-1">Adiciona uma conversa para o agente analisar</p>
                </div>
              ) : (
                <div className="space-y-4 relative before:absolute before:left-4 before:top-2 before:bottom-2 before:w-px before:bg-gray-100">
                  {interactions.slice(0, 10).map((interaction: {
                    id: string; type: string; summary?: string; occurred_at: string
                  }) => (
                    <div key={interaction.id} className="flex gap-4 pl-8 relative">
                      <div className="absolute left-2.5 w-3 h-3 rounded-full bg-white border-2 border-blue-300 mt-1 flex-shrink-0" />
                      <div className="min-w-0 flex-1 pb-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="outline" className="text-xs">
                            {INTERACTION_TYPE_LABELS[interaction.type as InteractionType] ?? interaction.type}
                          </Badge>
                          <span className="text-xs text-gray-400">{formatRelativeTime(interaction.occurred_at)}</span>
                        </div>
                        {interaction.summary && (
                          <p className="text-sm text-gray-600 mt-1 leading-relaxed">{interaction.summary}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
