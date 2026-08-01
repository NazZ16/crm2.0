// lib/listing-matching-engine.ts
// Scoring determinístico (zero chamadas Claude) entre um Listing (imóvel para
// venda/arrendamento) e leads compradores, usando lead_profiles.home_preferences
// e financial_profile. Espelha o estilo de lib/matching-engine.ts (investidores).

import type { Listing, LeadWithProfile, ListingMatchResult } from './types'

function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

function zoneMatches(zonas: string[], listing: Listing): boolean {
  const listingPlaces = [listing.zone, listing.municipality, listing.parish, listing.district, listing.address]
    .filter((v): v is string => !!v)
    .map(norm)
  return zonas.some((z) => {
    const nz = norm(z)
    return listingPlaces.some((p) => p.includes(nz) || nz.includes(p))
  })
}

export function scoreListingForLead(lead: LeadWithProfile, listing: Listing): ListingMatchResult {
  const reasons: Array<{ reason: string; positive: boolean }> = []
  let score = 0

  const prefs = lead.lead_profiles?.home_preferences ?? null
  const financial = lead.lead_profiles?.financial_profile ?? null
  const price = listing.price

  // Hard filter: orçamento (10% de margem)
  if (financial?.orcamento_max && price) {
    if (price > financial.orcamento_max * 1.1) {
      return {
        lead_id: lead.id,
        lead_name: lead.full_name,
        score: 0,
        reasons: [{ reason: `Preço (${price}€) acima do orçamento máximo (${financial.orcamento_max}€)`, positive: false }],
      }
    }
    if (price <= financial.orcamento_max) {
      score += 25
      reasons.push({ reason: 'Dentro do orçamento máximo', positive: true })
    } else {
      score += 10
      reasons.push({ reason: 'Ligeiramente acima do orçamento (dentro de margem de negociação)', positive: true })
    }
  } else {
    score += 10
  }

  // Zona (25 pts)
  if (prefs?.zonas && prefs.zonas.length > 0) {
    if (zoneMatches(prefs.zonas, listing)) {
      score += 25
      reasons.push({ reason: `Zona do imóvel coincide com preferências (${prefs.zonas.join(', ')})`, positive: true })
    } else {
      reasons.push({ reason: 'Zona fora das preferências indicadas', positive: false })
    }
  } else {
    score += 10
  }

  // Tipologia (20 pts)
  if (prefs?.tipologia && listing.typology) {
    if (norm(prefs.tipologia) === norm(listing.typology)) {
      score += 20
      reasons.push({ reason: `Tipologia ${listing.typology} corresponde à procurada`, positive: true })
    } else {
      reasons.push({ reason: `Tipologia ${listing.typology} diferente da procurada (${prefs.tipologia})`, positive: false })
    }
  } else {
    score += 8
  }

  // Área (15 pts)
  const area = listing.area_useful_m2 ?? listing.area_gross_m2
  if (area && (prefs?.area_min || prefs?.area_max)) {
    const min = prefs.area_min ?? 0
    const max = prefs.area_max ?? Infinity
    if (area >= min && area <= max) {
      score += 15
      reasons.push({ reason: `Área (${area}m²) dentro do intervalo pretendido`, positive: true })
    } else {
      reasons.push({ reason: `Área (${area}m²) fora do intervalo pretendido`, positive: false })
    }
  } else {
    score += 7
  }

  // Garagem (8 pts)
  if (prefs?.garagem === true) {
    if ((listing.parking_spaces ?? 0) > 0) {
      score += 8
      reasons.push({ reason: 'Tem garagem/estacionamento, como pretendido', positive: true })
    } else {
      reasons.push({ reason: 'Sem garagem/estacionamento (era pretendido)', positive: false })
    }
  } else {
    score += 4
  }

  // Elevador (7 pts)
  if (prefs?.elevador === true) {
    if (listing.has_elevator === true) {
      score += 7
      reasons.push({ reason: 'Tem elevador, como pretendido', positive: true })
    } else if (listing.has_elevator === false) {
      reasons.push({ reason: 'Sem elevador (era pretendido)', positive: false })
    }
  } else {
    score += 3
  }

  return {
    lead_id: lead.id,
    lead_name: lead.full_name,
    score: Math.min(Math.round(score), 100),
    reasons,
  }
}

export function scoreLeadsForListing(
  leads: LeadWithProfile[],
  listing: Listing,
  threshold = 40,
): ListingMatchResult[] {
  return leads
    .map((lead) => scoreListingForLead(lead, listing))
    .filter((r) => r.score >= threshold)
    .sort((a, b) => b.score - a.score)
}

export const DEFAULT_LISTING_MATCH_THRESHOLD = 40
