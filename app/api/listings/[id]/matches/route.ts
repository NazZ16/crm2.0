import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { scoreLeadsForListing, DEFAULT_LISTING_MATCH_THRESHOLD, ACTIVE_BUYER_LEAD_STATUSES } from '@/lib/listing-matching-engine'
import { fetchRejectionHistoryByLead } from '@/lib/listing-rejection-history'
import type { LeadWithProfile, Listing } from '@/lib/types'

// Matching determinístico (zero custo) entre um imóvel e as leads compradoras
// da equipa. Calculado on-the-fly — não é persistido, é sempre a versão mais
// recente do perfil da lead vs. do imóvel.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const service = createServiceClient()

  // Suporta autenticação por API key para a extensão de browser (sem cookie
  // de sessão), no mesmo padrão de /api/listings — para mostrar logo, ao
  // importar um imóvel, se há compradores reais compatíveis na base de dados.
  const apiKey = request.headers.get('X-API-Key')
  let teamId: string | null = null
  let usedApiKey = false

  if (apiKey) {
    const { hashApiKey } = await import('@/lib/api-keys')
    const keyHash = hashApiKey(apiKey)
    const { data: apiKeyRow } = await service
      .from('team_api_keys')
      .select('team_id')
      .eq('key_hash', keyHash)
      .is('revoked_at', null)
      .single()
    if (apiKeyRow) {
      teamId = apiKeyRow.team_id
      usedApiKey = true
    }
  }

  if (!teamId) {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

    const { data: member } = await supabase
      .from('team_members')
      .select('team_id')
      .eq('user_id', user.id)
      .single()

    if (!member) return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
    teamId = member.team_id
  }

  const db = usedApiKey ? service : supabase

  const { data: listing, error: listingError } = await db
    .from('listings')
    .select('*')
    .eq('id', id)
    .eq('team_id', teamId)
    .single()

  if (listingError || !listing) return NextResponse.json({ error: 'Imóvel não encontrado' }, { status: 404 })

  const { data: leads, error: leadsError } = await db
    .from('leads')
    .select('*, lead_profiles(*)')
    .eq('team_id', teamId)
    .in('lead_type', ['buyer', 'both'])
    .in('status', ACTIVE_BUYER_LEAD_STATUSES)

  if (leadsError) return NextResponse.json({ error: leadsError.message }, { status: 500 })

  // Supabase devolve lead_profiles como array na sintaxe de join usada acima,
  // mesmo sendo uma relação 1:1 — normalizar para objeto único (ou null).
  const normalizedLeads = (leads ?? []).map((lead) => {
    const profiles = (lead as { lead_profiles?: unknown }).lead_profiles
    const profile = Array.isArray(profiles) ? (profiles[0] ?? null) : (profiles ?? null)
    return { ...lead, lead_profiles: profile }
  })

  const rejectionHistoryByLead = await fetchRejectionHistoryByLead(
    db,
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
