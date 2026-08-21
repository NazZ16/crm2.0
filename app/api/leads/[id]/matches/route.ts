import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { scoreListingsForLead, DEFAULT_LISTING_MATCH_THRESHOLD, ACTIVE_BUYER_LEAD_STATUSES } from '@/lib/listing-matching-engine'
import { fetchRejectionHistoryByLead } from '@/lib/listing-rejection-history'
import type { LeadWithProfile, Listing } from '@/lib/types'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: member } = await supabase
    .from('team_members').select('team_id').eq('user_id', user.id).single()
  if (!member) return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })

  const { data: lead, error: leadError } = await supabase
    .from('leads').select('*, lead_profiles(*)').eq('id', id).eq('team_id', member.team_id).single()
  if (leadError || !lead) return NextResponse.json({ error: 'Lead não encontrada' }, { status: 404 })

  // Mesmo filtro de estado do lado imóvel→leads (/api/listings/[id]/matches) —
  // sem isto, uma lead em 'cpcv'/'escriturado'/'won'/'lost' aparecia como
  // match aqui mas não do lado do imóvel, um dos dois lados sempre errado.
  if (!ACTIVE_BUYER_LEAD_STATUSES.includes(lead.status)) return NextResponse.json([])

  const profiles = (lead as { lead_profiles?: unknown }).lead_profiles
  const profile = Array.isArray(profiles) ? (profiles[0] ?? null) : (profiles ?? null)
  const normalizedLead = { ...lead, lead_profiles: profile }

  const { data: listings, error: listingsError } = await supabase
    .from('listings').select('*').eq('team_id', member.team_id).eq('status', 'active')
    .not('is_published', 'is', false)
  if (listingsError) return NextResponse.json({ error: listingsError.message }, { status: 500 })

  const rejectionHistoryByLead = await fetchRejectionHistoryByLead(supabase, [id])

  const matches = scoreListingsForLead(
    normalizedLead as unknown as LeadWithProfile,
    (listings ?? []) as unknown as Listing[],
    rejectionHistoryByLead.get(id),
    DEFAULT_LISTING_MATCH_THRESHOLD,
  )
  return NextResponse.json(matches)
}
