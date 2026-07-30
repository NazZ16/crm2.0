import { createClient } from '@/lib/supabase/server'
import { LEAD_PIPELINE_ORDER, type LeadStatus } from '@/lib/types'
import { PipelineBoard, type PipelineLead } from './PipelineBoard'

export const dynamic = 'force-dynamic'

const COMMISSION_DEFAULT_RATE = 0.04 // fallback quando lead nao tem commission_value

export default async function PipelinePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: member } = await supabase
    .from('team_members')
    .select('team_id, role')
    .eq('user_id', user.id)
    .single()

  if (!member) return null

  const { data: leads } = await supabase
    .from('leads')
    .select(`
      id, full_name, phone, email, status, score, urgency,
      deal_value, commission_value, closed_at,
      last_contact_at, next_action_at, created_at,
      lead_profiles(summary)
    `)
    .eq('team_id', member.team_id)
    .order('updated_at', { ascending: false })
    .limit(500)

  const allLeads: PipelineLead[] = (leads ?? []).map((l) => {
    const profile = Array.isArray(l.lead_profiles) ? l.lead_profiles[0] : l.lead_profiles
    return {
      id: l.id as string,
      full_name: (l.full_name as string) ?? 'Sem nome',
      phone: (l.phone as string | null) ?? null,
      email: (l.email as string | null) ?? null,
      status: l.status as LeadStatus,
      score: (l.score as number) ?? 0,
      urgency: (l.urgency as number) ?? 1,
      deal_value: (l.deal_value as number | null) ?? null,
      commission_value: (l.commission_value as number | null) ?? null,
      closed_at: (l.closed_at as string | null) ?? null,
      last_contact_at: (l.last_contact_at as string | null) ?? null,
      next_action_at: (l.next_action_at as string | null) ?? null,
      created_at: l.created_at as string,
      summary: (profile?.summary as string | null) ?? null,
    }
  })

  // Agrupa por status seguindo LEAD_PIPELINE_ORDER
  const grouped: Record<LeadStatus, PipelineLead[]> = {
    new: [], qualified: [], meeting: [], active: [], cpcv: [], escriturado: [], won: [], lost: [],
  }
  for (const lead of allLeads) {
    if (grouped[lead.status]) grouped[lead.status].push(lead)
  }

  // Totais por coluna: comissao real ou estimada (deal_value * 4%)
  const totals: Record<LeadStatus, number> = {
    new: 0, qualified: 0, meeting: 0, active: 0, cpcv: 0, escriturado: 0, won: 0, lost: 0,
  }
  for (const status of LEAD_PIPELINE_ORDER) {
    totals[status] = grouped[status].reduce((sum, l) => {
      if (l.commission_value != null) return sum + l.commission_value
      if (l.deal_value != null) return sum + l.deal_value * COMMISSION_DEFAULT_RATE
      return sum
    }, 0)
  }

  const totalCount = allLeads.length

  return (
    <div className="p-4 md:p-6">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-gray-900">Pipeline</h1>
        <p className="text-sm text-gray-500 mt-1">
          {totalCount} leads no total. Arrasta entre colunas para mudar de estado. Totais sao a comissao real ou estimada a {(COMMISSION_DEFAULT_RATE * 100).toFixed(0)}% do valor do imovel.
        </p>
      </div>

      <PipelineBoard
        grouped={grouped}
        totals={totals}
        canEdit={member.role !== 'viewer'}
      />
    </div>
  )
}
