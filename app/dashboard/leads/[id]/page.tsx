import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { LEAD_STATUS_LABELS, LEAD_STATUS_COLORS, INTERACTION_TYPE_LABELS } from '@/lib/types'
import { formatRelativeTime, formatCurrency, getInitials } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { LeadDetailClient } from './LeadDetailClient'
import { TaskList } from './TaskList'
import { CopyButton } from './CopyButton'
import { PromoteToInvestorButton } from './PromoteToInvestorButton'
import { ScraperTriggerButton } from './ScraperTriggerButton'
import { EditLeadDetailsButton } from './EditLeadDetailsButton'
import { NewTaskButton } from '@/app/dashboard/tasks/NewTaskButton'
import {
  Phone, Mail, Calendar, Clock, ArrowLeft,
  MessageCircle, AlertTriangle, TrendingUp, Bot, Trophy,
} from 'lucide-react'
import Link from 'next/link'
import type { LeadStatus, InteractionType, AgentDraft, AgentRecommendations } from '@/lib/types'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

function fmtEur(v: number | null | undefined): string {
  if (v == null) return '-'
  return new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v)
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

  const { data: latestExtraction } = await supabase
    .from('agent_extractions')
    .select('id, extracted_json, drafts_json, recommendations_json, run_id, upload_id, created_at')
    .eq('lead_id', id)
    .eq('team_id', member.team_id)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  const { data: latestRun } = await supabase
    .from('agent_runs')
    .select('id, status, tokens_used, duration_ms, agent_type, output_json, error, created_at')
    .eq('team_id', member.team_id)
    .eq('lead_id', id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data: latestCallUpload } = await supabase
    .from('call_uploads')
    .select('id, coach_feedback, transcript_text, transcript_formatted, audio_duration_s, whisper_model, created_at, status')
    .eq('team_id', member.team_id)
    .eq('lead_id', lead.id)
    .eq('status', 'done')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data: existingInvestor } = await supabase
    .from('investors')
    .select('id')
    .eq('lead_id', lead.id)
    .eq('team_id', member.team_id)
    .maybeSingle()

  const { data: leadProfile } = await supabase
    .from('lead_profiles')
    .select('home_preferences, financial_profile')
    .eq('lead_id', lead.id)
    .maybeSingle()

  const leadZones = (leadProfile?.home_preferences as { zonas?: string[] } | null)?.zonas ?? undefined
  const leadBudget = (leadProfile?.financial_profile as { orcamento_max?: number } | null)?.orcamento_max ?? undefined
  const leadTypology = (leadProfile?.home_preferences as { tipologia?: string } | null)?.tipologia
  const leadTypologies = leadTypology ? [leadTypology] : undefined

  const profile = Array.isArray(lead.lead_profiles) ? lead.lead_profiles[0] : lead.lead_profiles
  const interactions = Array.isArray(lead.interactions) ? lead.interactions : []
  const tasks = Array.isArray(lead.tasks) ? lead.tasks : []
  const openTasks = tasks.filter((t: { status: string }) => t.status === 'open')
  const doneTasks = tasks.filter((t: { status: string }) => t.status === 'done')

  const drafts: AgentDraft[] = (latestExtraction?.drafts_json as { drafts?: AgentDraft[] } | null)?.drafts ?? []
  const recommendations = latestExtraction?.recommendations_json as AgentRecommendations | null

  const dealValue = lead.deal_value as number | null
  const commissionValue = lead.commission_value as number | null
  const closedAt = lead.closed_at as string | null
  const isWon = lead.status === 'won'

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <Link href="/dashboard/leads" className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1">
        <ArrowLeft size={14} />
        Voltar as leads
      </Link>

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
              <span className="text-sm text-gray-500">Urgencia: <strong>{lead.urgency}/5</strong></span>
              {lead.source && (
                <span className="text-xs bg-gray-100 px-2 py-0.5 rounded">{lead.source}</span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <LeadDetailClient
            leadId={lead.id}
            leadName={lead.full_name}
            currentStatus={lead.status as LeadStatus}
            canEdit={member.role !== 'viewer'}
            isAdmin={member.role === 'admin'}
          />
          {member.role !== 'viewer' && (
            <EditLeadDetailsButton
              leadId={lead.id}
              initialFullName={lead.full_name}
              initialPhone={lead.phone ?? null}
              initialEmail={lead.email ?? null}
              initialDealValue={dealValue}
              initialCommissionValue={commissionValue}
              initialClosedAt={closedAt}
            />
          )}
          {member.role !== 'viewer' && !existingInvestor && (
            <PromoteToInvestorButton
              leadId={lead.id}
              leadName={lead.full_name}
              suggestedZones={(leadProfile?.home_preferences as { zonas?: string[] } | null)?.zonas}
              suggestedBudgetMax={(leadProfile?.financial_profile as { orcamento_max?: number } | null)?.orcamento_max ?? undefined}
            />
          )}
          {existingInvestor && (
            <Link href={`/dashboard/investors/${existingInvestor.id}`}>
              <Badge variant="outline" className="text-emerald-700 border-emerald-300 cursor-pointer">
                <TrendingUp className="mr-1 h-3 w-3" /> Ver Perfil de Investidor
              </Badge>
            </Link>
          )}
          {member.role !== 'viewer' && (
            <ScraperTriggerButton
              leadId={lead.id}
              zones={leadZones}
              maxPrice={leadBudget}
              typologies={leadTypologies}
            />
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="space-y-4">
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
                  Ultimo contacto {formatRelativeTime(lead.last_contact_at)}
                </div>
              )}
            </CardContent>
          </Card>

          {(isWon || dealValue != null || commissionValue != null) && (
            <Card className="border-emerald-100 bg-emerald-50/40">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold text-emerald-800 uppercase tracking-wide flex items-center gap-2">
                  <Trophy size={14} />
                  Deal {isWon ? 'fechada' : 'em registo'}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Valor imovel</span>
                  <strong className="text-gray-900">{fmtEur(dealValue)}</strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Comissao</span>
                  <strong className="text-emerald-700">{fmtEur(commissionValue)}</strong>
                </div>
                {closedAt && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Fechada em</span>
                    <span className="text-gray-700">
                      {new Date(closedAt).toLocaleDateString('pt-PT', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {profile && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
                  Perfil IA
                  {profile.confidence_score != null && (
                    <span className="ml-2 font-normal text-gray-400 normal-case">
                      ({profile.confidence_score}% confianca)
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
                    <span className="font-medium text-gray-700">Orcamento: </span>
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
                      Objecoes:
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

          {latestCallUpload?.coach_feedback && (() => {
            const feedback = latestCallUpload.coach_feedback as {
              pontos_positivos: string[]
              a_melhorar: string[]
              proxima_chamada: string
              sentimento_lead: string
            }
            return (
              <Card className="border-purple-100">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold text-gray-700 uppercase tracking-wide flex items-center gap-2">
                    <Bot size={14} className="text-purple-500" />
                    Feedback da Chamada
                    <span className="font-normal text-gray-400 normal-case text-xs ml-auto">
                      {formatRelativeTime(latestCallUpload.created_at)}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  {feedback.pontos_positivos.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-green-600 mb-1">Positivo</p>
                      <ul className="space-y-0.5">
                        {feedback.pontos_positivos.map((p: string, i: number) => (
                          <li key={i} className="text-xs text-gray-600">{p}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {feedback.a_melhorar.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-orange-600 mb-1">A melhorar</p>
                      <ul className="space-y-0.5">
                        {feedback.a_melhorar.map((p: string, i: number) => (
                          <li key={i} className="text-xs text-gray-600">{p}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div>
                    <p className="text-xs font-semibold text-blue-600 mb-1">Proxima chamada</p>
                    <p className="text-xs text-gray-600">{feedback.proxima_chamada}</p>
                  </div>
                  <Badge variant="outline" className="text-xs">
                    {feedback.sentimento_lead.replace(/_/g, ' ')}
                  </Badge>
                </CardContent>
              </Card>
            )
          })()}
        </div>

        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
                Tarefas
                {openTasks.length > 0 && (
                  <Badge className="ml-2 bg-blue-100 text-blue-700 font-normal">{openTasks.length}</Badge>
                )}
              </CardTitle>
              {member.role !== 'viewer' && (
                <NewTaskButton
                  variant="outline"
                  size="sm"
                  label="Nova"
                  defaultLead={{ id: lead.id, full_name: lead.full_name }}
                />
              )}
            </CardHeader>
            <CardContent>
              <TaskList initialOpenTasks={openTasks} initialDoneTasks={doneTasks} />
            </CardContent>
          </Card>

          {latestExtraction && (drafts.length > 0 || (recommendations?.next_questions && recommendations.next_questions.length > 0)) && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
                  Ultimas Sugestoes IA
                  <span className="ml-2 font-normal text-gray-400 normal-case text-xs">
                    {formatRelativeTime(latestExtraction.created_at)}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {recommendations?.next_questions && recommendations.next_questions.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Perguntas por fazer</p>
                    <ul className="space-y-1">
                      {recommendations.next_questions.map((q, i) => (
                        <li key={i} className="text-sm text-gray-600 bg-gray-50 px-3 py-1.5 rounded">
                          {q}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {drafts.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase mb-2">
                      Rascunhos de Mensagem
                    </p>
                    <div className="space-y-3">
                      {drafts.map((draft, i) => (
                        <DraftCard key={i} draft={draft} index={i} leadPhone={lead.phone ?? null} />
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
                Historico de Interacoes
                <span className="ml-2 font-normal text-gray-400 normal-case">({interactions.length})</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {interactions.length === 0 ? (
                <div className="text-center py-6">
                  <MessageCircle size={32} className="mx-auto text-gray-200 mb-2" />
                  <p className="text-sm text-gray-400">Sem interacoes registadas</p>
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

          {(latestExtraction || latestCallUpload || latestRun) && (
            <Card className="border-dashed border-gray-300">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-2">
                  <Bot size={14} />
                  Debug - Analise do Agente
                  <span className="ml-auto font-normal text-gray-400 normal-case text-xs">
                    para verificacao
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {latestRun && (
                  <div className="flex flex-wrap gap-3 text-xs text-gray-600 border-b border-gray-100 pb-3">
                    <span><strong>Status:</strong> {latestRun.status}</span>
                    {latestRun.tokens_used != null && (
                      <span><strong>Tokens:</strong> {latestRun.tokens_used.toLocaleString()}</span>
                    )}
                    {latestRun.duration_ms != null && (
                      <span><strong>Duracao:</strong> {(latestRun.duration_ms / 1000).toFixed(1)}s</span>
                    )}
                    <span><strong>Tipo:</strong> {latestRun.agent_type}</span>
                    {latestRun.error && (
                      <span className="text-red-600"><strong>Erro:</strong> {latestRun.error}</span>
                    )}
                  </div>
                )}

                {latestCallUpload?.transcript_formatted && (
                  <details open>
                    <summary className="cursor-pointer font-medium text-gray-700 hover:text-blue-600">
                      Transcricao formatada (Agente / Lead)
                      <span className="ml-2 text-xs text-gray-400 font-normal">
                        ({latestCallUpload.transcript_formatted.length.toLocaleString()} chars - Haiku diarization)
                      </span>
                    </summary>
                    <pre className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded text-xs text-gray-800 whitespace-pre-wrap max-h-96 overflow-y-auto">
                      {latestCallUpload.transcript_formatted}
                    </pre>
                  </details>
                )}

                {latestCallUpload?.transcript_text && (
                  <details>
                    <summary className="cursor-pointer font-medium text-gray-700 hover:text-blue-600">
                      Transcricao Whisper (bruta)
                      <span className="ml-2 text-xs text-gray-400 font-normal">
                        ({latestCallUpload.transcript_text.length.toLocaleString()} chars
                        {latestCallUpload.audio_duration_s
                          ? `, ${Math.round(latestCallUpload.audio_duration_s / 60)}min`
                          : ''})
                      </span>
                    </summary>
                    <pre className="mt-2 p-3 bg-gray-50 border border-gray-200 rounded text-xs text-gray-700 whitespace-pre-wrap max-h-96 overflow-y-auto">
                      {latestCallUpload.transcript_text}
                    </pre>
                  </details>
                )}

                {latestExtraction?.extracted_json != null && (
                  <details>
                    <summary className="cursor-pointer font-medium text-gray-700 hover:text-blue-600">
                      lead_updates (extracted_json)
                    </summary>
                    <pre className="mt-2 p-3 bg-gray-50 border border-gray-200 rounded text-xs text-gray-700 whitespace-pre-wrap max-h-96 overflow-y-auto">
                      {JSON.stringify(latestExtraction.extracted_json, null, 2)}
                    </pre>
                  </details>
                )}

                {latestExtraction?.recommendations_json != null && (
                  <details>
                    <summary className="cursor-pointer font-medium text-gray-700 hover:text-blue-600">
                      recommendations_json
                    </summary>
                    <pre className="mt-2 p-3 bg-gray-50 border border-gray-200 rounded text-xs text-gray-700 whitespace-pre-wrap max-h-96 overflow-y-auto">
                      {JSON.stringify(latestExtraction.recommendations_json, null, 2)}
                    </pre>
                  </details>
                )}

                {latestExtraction?.drafts_json != null && (
                  <details>
                    <summary className="cursor-pointer font-medium text-gray-700 hover:text-blue-600">
                      drafts_json
                    </summary>
                    <pre className="mt-2 p-3 bg-gray-50 border border-gray-200 rounded text-xs text-gray-700 whitespace-pre-wrap max-h-96 overflow-y-auto">
                      {JSON.stringify(latestExtraction.drafts_json, null, 2)}
                    </pre>
                  </details>
                )}

                {latestRun?.output_json != null && (
                  <details>
                    <summary className="cursor-pointer font-medium text-gray-700 hover:text-blue-600">
                      agent_run output (raw)
                    </summary>
                    <pre className="mt-2 p-3 bg-gray-50 border border-gray-200 rounded text-xs text-gray-700 whitespace-pre-wrap max-h-96 overflow-y-auto">
                      {JSON.stringify(latestRun.output_json, null, 2)}
                    </pre>
                  </details>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

function DraftCard({ draft, index, leadPhone }: { draft: AgentDraft; index: number; leadPhone: string | null }) {
  const waLink = leadPhone && draft.channel === 'whatsapp'
    ? `https://wa.me/${leadPhone.replace(/[^\d]/g, '')}?text=${encodeURIComponent(draft.body)}`
    : null
  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">
            {draft.channel === 'whatsapp' ? 'WhatsApp' : 'Email'}
          </Badge>
          <span className="text-xs text-gray-500">{draft.goal}</span>
        </div>
        <div className="flex items-center gap-2">
          {waLink && (
            <a
              href={waLink}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-green-700 hover:text-green-900 font-medium"
            >
              Abrir WhatsApp
            </a>
          )}
          <CopyButton text={draft.body} id={`saved-draft-${index}`} />
        </div>
      </div>
      {draft.subject && (
        <div className="px-3 py-1.5 bg-blue-50 border-b text-xs font-medium text-blue-700">
          Assunto: {draft.subject}
        </div>
      )}
      <div className="p-3">
        <p className="text-sm text-gray-700 whitespace-pre-wrap">{draft.body}</p>
      </div>
    </div>
  )
}
