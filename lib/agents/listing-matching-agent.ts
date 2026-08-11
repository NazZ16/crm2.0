// lib/agents/listing-matching-agent.ts
// Alertas proativos buyer↔imóvel — mirror do padrão já usado para
// investidor↔oportunidade em app/api/agents/matching/route.ts, mas chamado
// diretamente (sem hop HTTP) a partir dos pontos de inserção de listings,
// já que corre no mesmo processo.

import type { SupabaseClient } from '@supabase/supabase-js'
import { scoreLeadsForListing, DEFAULT_LISTING_MATCH_THRESHOLD } from '@/lib/listing-matching-engine'
import { fetchRejectionHistoryByLead } from '@/lib/listing-rejection-history'
import type { Listing, LeadWithProfile } from '@/lib/types'

async function fetchActiveBuyerLeads(supabase: SupabaseClient, teamId: string): Promise<LeadWithProfile[]> {
  const { data: leads } = await supabase
    .from('leads')
    .select('*, lead_profiles(*)')
    .eq('team_id', teamId)
    .in('lead_type', ['buyer', 'both'])
    .in('status', ['new', 'qualified', 'meeting', 'active'])

  return (leads ?? []).map((lead) => {
    const profiles = (lead as { lead_profiles?: unknown }).lead_profiles
    const profile = Array.isArray(profiles) ? (profiles[0] ?? null) : (profiles ?? null)
    return { ...lead, lead_profiles: profile }
  }) as unknown as LeadWithProfile[]
}

/** Um imóvel novo — notifica se houver ≥1 comprador compatível. */
export async function notifyBuyersForNewListing(supabase: SupabaseClient, listing: Listing): Promise<void> {
  if (listing.status !== 'active') return

  const leads = await fetchActiveBuyerLeads(supabase, listing.team_id)
  if (leads.length === 0) return

  const rejectionHistoryByLead = await fetchRejectionHistoryByLead(supabase, leads.map((l) => l.id))
  const matches = scoreLeadsForListing(leads, listing, rejectionHistoryByLead, DEFAULT_LISTING_MATCH_THRESHOLD)
  if (matches.length === 0) return

  await supabase.from('notifications').insert({
    team_id: listing.team_id,
    type: 'agent_complete',
    title: 'Novos matches encontrados',
    body: `"${listing.title}" tem ${matches.length} comprador${matches.length > 1 ? 'es' : ''} compatível${matches.length > 1 ? 'eis' : ''} (score ≥ ${DEFAULT_LISTING_MATCH_THRESHOLD})`,
    link: `/dashboard/listings/${listing.id}`,
    user_id: null,
  })
}

/** Vários imóveis novos de uma vez (scraper em lote) — uma única notificação-resumo. */
export async function notifyBuyersForNewListingsBatch(
  supabase: SupabaseClient,
  teamId: string,
  listings: Listing[],
): Promise<void> {
  const activeListings = listings.filter((l) => l.status === 'active')
  if (activeListings.length === 0) return

  const leads = await fetchActiveBuyerLeads(supabase, teamId)
  if (leads.length === 0) return

  const rejectionHistoryByLead = await fetchRejectionHistoryByLead(supabase, leads.map((l) => l.id))

  let listingsWithMatches = 0
  const buyersReached = new Set<string>()
  for (const listing of activeListings) {
    const matches = scoreLeadsForListing(leads, listing, rejectionHistoryByLead, DEFAULT_LISTING_MATCH_THRESHOLD)
    if (matches.length > 0) {
      listingsWithMatches++
      matches.forEach((m) => buyersReached.add(m.lead_id))
    }
  }
  if (listingsWithMatches === 0) return

  await supabase.from('notifications').insert({
    team_id: teamId,
    type: 'agent_complete',
    title: 'Novos matches encontrados',
    body: `${listingsWithMatches} imóvel${listingsWithMatches > 1 ? 'is' : ''} novo${listingsWithMatches > 1 ? 's' : ''} do scraper ${listingsWithMatches > 1 ? 'têm' : 'tem'} compradores compatíveis (${buyersReached.size} lead${buyersReached.size > 1 ? 's' : ''}, score ≥ ${DEFAULT_LISTING_MATCH_THRESHOLD})`,
    link: `/dashboard/listings`,
    user_id: null,
  })
}
