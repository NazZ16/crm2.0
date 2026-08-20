import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { listingSchema } from '@/lib/schemas/listing'
import { scoreLeadsForListing, DEFAULT_LISTING_MATCH_THRESHOLD } from '@/lib/listing-matching-engine'
import { fetchRejectionHistoryByLead } from '@/lib/listing-rejection-history'
import type { LeadWithProfile, Listing } from '@/lib/types'

// Mesmo matching determinístico de /api/listings/[id]/matches, mas sobre um
// imóvel que ainda não foi guardado — usado pela extensão para responder
// "tenho comprador para isto?" só de abrires a página do anúncio, sem teres
// de importar primeiro. Sem embedding (não vale a pena gastar uma chamada
// OpenAI só para espreitares uma página) — o motor já lida bem com a
// ausência de embedding, ignora só o bónus semântico.
export async function POST(request: Request) {
  const supabase = await createClient()
  const service = createServiceClient()

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

    if (!member) return NextResponse.json({ error: 'Equipa não encontrada' }, { status: 403 })
    teamId = member.team_id
  }

  const db = usedApiKey ? service : supabase

  const body = await request.json()
  const parsed = listingSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const { data: leads, error: leadsError } = await db
    .from('leads')
    .select('*, lead_profiles(*)')
    .eq('team_id', teamId)
    .in('lead_type', ['buyer', 'both'])
    .in('status', ['new', 'qualified', 'meeting', 'active'])

  if (leadsError) return NextResponse.json({ error: leadsError.message }, { status: 500 })

  const normalizedLeads = (leads ?? []).map((lead) => {
    const profiles = (lead as { lead_profiles?: unknown }).lead_profiles
    const profile = Array.isArray(profiles) ? (profiles[0] ?? null) : (profiles ?? null)
    return { ...lead, lead_profiles: profile }
  })

  const rejectionHistoryByLead = await fetchRejectionHistoryByLead(
    db,
    normalizedLeads.map((lead) => (lead as { id: string }).id),
  )

  const previewListing = { ...parsed.data, id: 'preview', team_id: teamId, embedding: null }

  const matches = scoreLeadsForListing(
    normalizedLeads as unknown as LeadWithProfile[],
    previewListing as unknown as Listing,
    rejectionHistoryByLead,
    DEFAULT_LISTING_MATCH_THRESHOLD,
  )

  return NextResponse.json(matches)
}
