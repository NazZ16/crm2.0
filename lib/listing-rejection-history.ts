// lib/listing-rejection-history.ts
// Histórico de rejeições por lead, usado para penalizar sugestões repetidas
// no motor de matching (lib/listing-matching-engine.ts). Fica separado do
// engine porque faz uma query à BD — o engine mantém-se puro/síncrono.

import type { SupabaseClient } from '@supabase/supabase-js'
import { norm } from './listing-matching-engine'

export interface RejectionHistory {
  rejectedListingIds: Set<string>
  rejectedZones: Set<string>
  rejectedTipologias: Set<string>
}

function emptyHistory(): RejectionHistory {
  return { rejectedListingIds: new Set(), rejectedZones: new Set(), rejectedTipologias: new Set() }
}

export async function fetchRejectionHistoryByLead(
  supabase: SupabaseClient,
  leadIds: string[],
): Promise<Map<string, RejectionHistory>> {
  const result = new Map<string, RejectionHistory>()
  if (leadIds.length === 0) return result

  const { data, error } = await supabase
    .from('interactions')
    .select('lead_id, listing_id, rejection_reason, listings(zone, typology)')
    .in('lead_id', leadIds)
    .eq('outcome', 'rejeitado')

  if (error) {
    console.error('[listing-rejection-history] falha ao buscar histórico de rejeições:', error)
    return result
  }
  if (!data) return result

  for (const row of data as unknown as Array<{
    lead_id: string
    listing_id: string | null
    rejection_reason: string | null
    listings: { zone: string | null; typology: string | null } | { zone: string | null; typology: string | null }[] | null
  }>) {
    const history = result.get(row.lead_id) ?? emptyHistory()
    if (row.listing_id) history.rejectedListingIds.add(row.listing_id)

    const listing = Array.isArray(row.listings) ? (row.listings[0] ?? null) : row.listings
    if (row.rejection_reason === 'localizacao' && listing?.zone) {
      history.rejectedZones.add(norm(listing.zone))
    }
    if (row.rejection_reason === 'tipologia' && listing?.typology) {
      history.rejectedTipologias.add(norm(listing.typology))
    }
    result.set(row.lead_id, history)
  }

  return result
}
