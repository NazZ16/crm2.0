import { createClient } from '@/lib/supabase/server'
import { ColdLeadsClient, type ColdLead } from './ColdLeadsClient'
import { Snowflake } from 'lucide-react'
import type { LeadStatus, LeadType } from '@/lib/types'

export const dynamic = 'force-dynamic'

interface Props {
  searchParams: Promise<{ days?: string; status?: string }>
}

export default async function ColdLeadsPage({ searchParams }: Props) {
  const { days: daysParam, status: statusParam } = await searchParams
  const minDays = Math.max(7, parseInt(daysParam ?? '14', 10) || 14)

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: member } = await supabase
    .from('team_members')
    .select('team_id, role')
    .eq('user_id', user.id)
    .single()
  if (!member) return null

  const cutoffDate = new Date(Date.now() - minDays * 24 * 60 * 60 * 1000).toISOString()

  // Leads frias: nao won/lost + last_contact_at antes do cutoff (ou created_at se null)
  let query = supabase
    .from('leads')
    .select(`
      id, full_name, phone, email, status, score, urgency, lead_type,
      last_contact_at, created_at,
      lead_profiles(summary)
    `)
    .eq('team_id', member.team_id)
    .not('status', 'in', '(won,lost)')
    .or(`last_contact_at.lt.${cutoffDate},and(last_contact_at.is.null,created_at.lt.${cutoffDate})`)
    .order('last_contact_at', { ascending: true, nullsFirst: true })
    .limit(100)

  if (statusParam && ['qualified', 'meeting', 'active', 'cpcv', 'escriturado'].includes(statusParam)) {
    query = query.eq('status', statusParam)
  }

  const { data: rows } = await query
  const now = Date.now()

  const leads: ColdLead[] = (rows ?? []).map((l) => {
    const ref = l.last_contact_at ?? l.created_at
    const daysIdle = Math.floor((now - new Date(ref as string).getTime()) / (24 * 60 * 60 * 1000))
    const profile = Array.isArray(l.lead_profiles) ? l.lead_profiles[0] : l.lead_profiles
    return {
      id: l.id as string,
      full_name: (l.full_name as string) ?? 'Sem nome',
      phone: (l.phone as string | null) ?? null,
      email: (l.email as string | null) ?? null,
      status: l.status as LeadStatus,
      lead_type: ((l.lead_type as LeadType | null | undefined) ?? 'unknown') as LeadType,
      score: (l.score as number) ?? 0,
      urgency: (l.urgency as number) ?? 1,
      last_contact_at: (l.last_contact_at as string | null) ?? null,
      created_at: l.created_at as string,
      summary: (profile?.summary as string | null) ?? null,
      daysIdle,
    }
  })

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4 md:space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex items-start gap-3">
          <div className="p-2 bg-blue-50 rounded-lg flex-shrink-0">
            <Snowflake size={20} className="text-blue-500" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl md:text-2xl font-bold text-gray-900">Leads frias</h1>
            <p className="text-xs md:text-sm text-gray-500 mt-0.5">
              {leads.length} lead{leads.length === 1 ? '' : 's'} sem contacto ha {minDays}+ dias.
              Gera mensagem de re-engagement com IA e envia em 1 clique.
            </p>
          </div>
        </div>
      </div>

      <ColdLeadsClient leads={leads} minDays={minDays} statusFilter={statusParam ?? null} />
    </div>
  )
}
