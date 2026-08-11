import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { scoreLeadsForListing, DEFAULT_LISTING_MATCH_THRESHOLD } from '@/lib/listing-matching-engine'
import { fetchRejectionHistoryByLead } from '@/lib/listing-rejection-history'
import type { LeadWithProfile, Listing } from '@/lib/types'

// Matching determinístico (zero custo) entre um imóvel e as leads compradoras
// da equipa. Calculado on-the-fly — não é persistido, é sempre a versão mais
// recente do perfil da lead vs. do imóvel.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: member } = await supabase
    .from('team_members')
    .select('team_id')
    .eq('user_id', user.id)
    .single()

  if (!member) return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })

  const { data: listing, error: listingError } = await supabase
    .from('listings')
    .select('*')
    .eq('id', id)
    .eq('team_id', member.team_id)
    .single()

  if (listingError || !listing) return NextResponse.json({ error: 'Imóvel não encontrado' }, { status: 404 })

  const { data: leads, error: leadsError } = await supabase
    .from('leads')
    .select('*, lead_profiles(*)')
    .eq('team_id', member.team_id)
    .in('lead_type', ['buyer', 'both'])
    .in('status', ['new', 'qualified', 'meeting', 'active'])

  if (leadsError) return NextResponse.json({ error: leadsError.message }, { status: 500 })

  // Supabase devolve lead_profiles como array na sintaxe de join usada acima,
  // mesmo sendo uma relação 1:1 — normalizar para objeto único (ou null).
  const normalizedLeads = (leads ?? []).map((lead) => {
    const profiles = (lead as { lead_profiles?: unknown }).lead_profiles
    const profile = Array.isArray(profiles) ? (profiles[0] ?? null) : (profiles ?? null)
    return { ...lead, lead_profiles: profile }
  })

  const rejectionHistoryByLead = await fetchRejectionHistoryByLead(
    supabase,
    normalizedLeads.map((lead) => (lead as { id: string }).id),
  )

  const matches = scoreLeadsForListing(
    normalizedLeads as unknown as LeadWithProfile[],
    listing as unknown as Listing,
    rejectionHistoryByLead,
    DEFAULT_LISTING_MATCH_THRESHOLD,
  )

  return NextResponse.json(matches)
}
