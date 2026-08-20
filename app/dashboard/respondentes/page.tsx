import { createClient } from '@/lib/supabase/server'
import { RespondentesClient, type Respondente } from './RespondentesClient'
import { MessageCircleReply } from 'lucide-react'
import type { LeadStatus, LeadType, AgentExtractionResult, AgentRecommendations, AgentDrafts } from '@/lib/types'

export const dynamic = 'force-dynamic'

interface Props {
  searchParams: Promise<{ days?: string }>
}

const DAYS_OPTIONS = [3, 7, 14, 30]

export default async function RespondentesPage({ searchParams }: Props) {
  const { days: daysParam } = await searchParams
  const parsedDays = parseInt(daysParam ?? '14', 10)
  const days = DAYS_OPTIONS.includes(parsedDays) ? parsedDays : 14

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: member } = await supabase
    .from('team_members')
    .select('team_id, role')
    .eq('user_id', user.id)
    .single()
  if (!member) return null

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

  // Última mensagem recebida (inbound) por lead, dentro da janela seleccionada.
  const { data: inboundRows } = await supabase
    .from('interactions')
    .select('lead_id, raw_text, summary, occurred_at')
    .eq('team_id', member.team_id)
    .eq('type', 'whatsapp')
    .eq('direction', 'inbound')
    .gte('occurred_at', since)
    .order('occurred_at', { ascending: false })

  const lastMessageByLead = new Map<string, { text: string; occurredAt: string }>()
  for (const row of inboundRows ?? []) {
    const leadId = row.lead_id as string
    if (lastMessageByLead.has(leadId)) continue // já vem ordenado desc — a primeira é a mais recente
    lastMessageByLead.set(leadId, {
      text: (row.raw_text as string | null) ?? (row.summary as string | null) ?? '',
      occurredAt: row.occurred_at as string,
    })
  }

  const leadIds = [...lastMessageByLead.keys()]

  const [leadsRes, extractionsRes] = await Promise.all([
    leadIds.length > 0
      ? supabase
          .from('leads')
          .select('id, full_name, phone, status, lead_type, score, urgency, last_contact_at')
          .eq('team_id', member.team_id)
          .in('id', leadIds)
      : Promise.resolve({ data: [] as never[] }),
    leadIds.length > 0
      ? supabase
          .from('agent_extractions')
          .select('id, lead_id, extracted_json, drafts_json, recommendations_json, status, created_at')
          .eq('team_id', member.team_id)
          .eq('status', 'pending')
          .in('lead_id', leadIds)
          .order('created_at', { ascending: false })
      : Promise.resolve({ data: [] as never[] }),
  ])

  const pendingByLead = new Map<string, {
    id: string
    extracted_json: AgentExtractionResult
    recommendations_json: AgentRecommendations
    drafts_json: AgentDrafts
  }>()
  for (const row of extractionsRes.data ?? []) {
    const leadId = row.lead_id as string
    // já vem ordenado desc por created_at — mantém só a mais recente pendente
    if (pendingByLead.has(leadId)) continue
    if (row.extracted_json == null || row.recommendations_json == null || row.drafts_json == null) continue
    pendingByLead.set(leadId, {
      id: row.id as string,
      extracted_json: row.extracted_json as AgentExtractionResult,
      recommendations_json: row.recommendations_json as AgentRecommendations,
      drafts_json: row.drafts_json as AgentDrafts,
    })
  }

  const respondentes: Respondente[] = (leadsRes.data ?? [])
    .map((l) => {
      const lastMessage = lastMessageByLead.get(l.id as string)
      if (!lastMessage) return null
      return {
        id: l.id as string,
        full_name: (l.full_name as string) ?? 'Sem nome',
        phone: (l.phone as string | null) ?? null,
        status: l.status as LeadStatus,
        lead_type: ((l.lead_type as LeadType | null | undefined) ?? 'unknown') as LeadType,
        score: (l.score as number) ?? 0,
        urgency: (l.urgency as number) ?? 1,
        lastMessageText: lastMessage.text,
        lastMessageAt: lastMessage.occurredAt,
        pendingExtraction: pendingByLead.get(l.id as string) ?? null,
      } satisfies Respondente
    })
    .filter((r): r is Respondente => r !== null)
    // Pendente de revisão primeiro (ação disponível já), depois mensagem mais recente.
    .sort((a, b) => {
      if (!!a.pendingExtraction !== !!b.pendingExtraction) {
        return a.pendingExtraction ? -1 : 1
      }
      return new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()
    })

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4 md:space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex items-start gap-3">
          <div className="p-2 bg-green-50 rounded-lg flex-shrink-0">
            <MessageCircleReply size={20} className="text-green-600" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl md:text-2xl font-bold text-gray-900">Respondentes</h1>
            <p className="text-xs md:text-sm text-gray-500 mt-0.5">
              {respondentes.length} lead{respondentes.length === 1 ? '' : 's'} responderam por WhatsApp
              nos últimos {days} dias — quem está activo e o que procura.
            </p>
          </div>
        </div>
      </div>

      <RespondentesClient respondentes={respondentes} days={days} daysOptions={DAYS_OPTIONS} />
    </div>
  )
}
