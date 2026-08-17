// lib/listing-matching-engine.ts
// Scoring determinístico (zero chamadas Claude) entre um Listing (imóvel para
// venda/arrendamento) e leads compradores, usando lead_profiles.home_preferences
// e financial_profile. Espelha o estilo de lib/matching-engine.ts (investidores).

import type { Listing, LeadWithProfile, ListingMatchResult, LeadListingMatchResult } from './types'
import { parseEmbedding, cosineSimilarity } from './embeddings'
import type { RejectionHistory } from './listing-rejection-history'

// Penalizações por histórico de rejeição (ver lib/listing-rejection-history.ts).
// Mais pequenas que os bónus positivos equivalentes — é um sinal de que a
// lead já disse não a algo parecido, não uma certeza de que vai voltar a
// dizer não.
const REJECTED_ZONE_PENALTY = 15
const REJECTED_TIPOLOGIA_PENALTY = 10

// Bónus semântico (camada adicional, não substitui as regras acima): captura
// nuance textual (descrição do imóvel vs. notas/preferências da lead) que os
// campos estruturados não veem. Sem embedding de um dos lados, não entra em
// jogo — comportamento idêntico ao motor 100% determinístico.
const SEMANTIC_MAX_BONUS = 10
const SEMANTIC_SIMILARITY_FLOOR = 0.5

export function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

// Nota: propositadamente sem `district` — um distrito português cobre
// dezenas de km (ex.: distrito do Porto vai da cidade até Amarante/Baião),
// pelo que contar como match de zona dava falsos positivos a imóveis longe
// do que a lead pediu.
function zoneMatches(zonas: string[], listing: Listing): boolean {
  const listingPlaces = [listing.zone, listing.municipality, listing.parish, listing.address]
    .filter((v): v is string => !!v)
    .map(norm)
  return zonas.some((z) => {
    const nz = norm(z)
    return listingPlaces.some((p) => p.includes(nz) || nz.includes(p))
  })
}

interface MatchComputation {
  score: number
  reasons: Array<{ reason: string; positive: boolean }>
}

function computeMatch(
  lead: LeadWithProfile,
  listing: Listing,
  rejectionHistory?: RejectionHistory,
): MatchComputation {
  const reasons: Array<{ reason: string; positive: boolean }> = []
  let score = 0

  const prefs = lead.lead_profiles?.home_preferences ?? null
  const financial = lead.lead_profiles?.financial_profile ?? null
  const price = listing.price

  // Hard filter: comprar vs arrendar — imóveis completamente diferentes,
  // nunca sugerir arrendamento a quem procura comprar (e vice-versa).
  if (prefs?.tipo_negocio && prefs.tipo_negocio !== listing.business_type) {
    return {
      score: 0,
      reasons: [{
        reason: `Lead procura ${prefs.tipo_negocio === 'venda' ? 'comprar' : 'arrendar'}, este imóvel é para ${listing.business_type}`,
        positive: false,
      }],
    }
  }

  // Hard filter: a lead já rejeitou este imóvel exato anteriormente
  if (rejectionHistory?.rejectedListingIds.has(listing.id)) {
    return {
      score: 0,
      reasons: [{ reason: 'Lead já rejeitou este imóvel anteriormente', positive: false }],
    }
  }

  // Hard filter: orçamento (10% de margem)
  if (financial?.orcamento_max && price) {
    if (price > financial.orcamento_max * 1.1) {
      return {
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
    // Sem orçamento definido no perfil: crédito neutro baixo — não há sinal
    // real de match, não deve empurrar o score para cima do threshold sozinho.
    score += 4
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
    score += 4
  }

  // Penalização: lead já rejeitou um imóvel nesta zona por motivo de localização
  if (rejectionHistory?.rejectedZones.size && zoneMatches([...rejectionHistory.rejectedZones], listing)) {
    score -= REJECTED_ZONE_PENALTY
    reasons.push({ reason: 'Lead rejeitou anteriormente um imóvel nesta zona por localização', positive: false })
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
    score += 3
  }

  // Penalização: lead já rejeitou um imóvel desta tipologia por motivo de tipologia
  if (listing.typology && rejectionHistory?.rejectedTipologias.has(norm(listing.typology))) {
    score -= REJECTED_TIPOLOGIA_PENALTY
    reasons.push({ reason: 'Lead rejeitou anteriormente esta tipologia', positive: false })
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
    score += 2
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
    score += 1
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
    score += 1
  }

  // Semântica (bónus até 10 pts) — ver comentário no topo do ficheiro.
  const listingEmbedding = parseEmbedding(listing.embedding)
  const leadEmbedding = parseEmbedding(lead.lead_profiles?.embedding)
  if (listingEmbedding && leadEmbedding) {
    const similarity = cosineSimilarity(listingEmbedding, leadEmbedding)
    if (similarity > SEMANTIC_SIMILARITY_FLOOR) {
      const bonus = Math.round(
        SEMANTIC_MAX_BONUS * ((similarity - SEMANTIC_SIMILARITY_FLOOR) / (1 - SEMANTIC_SIMILARITY_FLOOR))
      )
      if (bonus > 0) {
        score += bonus
        reasons.push({ reason: 'Descrição alinha-se com o que o cliente procura', positive: true })
      }
    }
  }

  return {
    score: Math.max(0, Math.min(Math.round(score), 100)),
    reasons,
  }
}

export function scoreListingForLead(
  lead: LeadWithProfile,
  listing: Listing,
  rejectionHistory?: RejectionHistory,
): ListingMatchResult {
  const { score, reasons } = computeMatch(lead, listing, rejectionHistory)
  return { lead_id: lead.id, lead_name: lead.full_name, score, reasons }
}

export function scoreLeadsForListing(
  leads: LeadWithProfile[],
  listing: Listing,
  rejectionHistoryByLead?: Map<string, RejectionHistory>,
  threshold = DEFAULT_LISTING_MATCH_THRESHOLD,
): ListingMatchResult[] {
  return leads
    .map((lead) => scoreListingForLead(lead, listing, rejectionHistoryByLead?.get(lead.id)))
    .filter((r) => r.score >= threshold)
    .sort((a, b) => b.score - a.score)
}

export function scoreListingsForLead(
  lead: LeadWithProfile,
  listings: Listing[],
  rejectionHistory?: RejectionHistory,
  threshold = DEFAULT_LISTING_MATCH_THRESHOLD,
): LeadListingMatchResult[] {
  return listings
    .map((listing) => {
      const { score, reasons } = computeMatch(lead, listing, rejectionHistory)
      return {
        listing_id: listing.id,
        listing_title: listing.title,
        listing_price: listing.price,
        listing_business_type: listing.business_type,
        listing_property_type: listing.property_type,
        score,
        reasons,
      }
    })
    .filter((r) => r.score >= threshold)
    .sort((a, b) => b.score - a.score)
}

// 55: perfis de lead incompletos (sem zona/tipologia/orçamento) já não
// acumulam pontos "neutros" suficientes para passar sozinhos — só passam
// leads com sinal real de match, e o threshold reflete isso.
export const DEFAULT_LISTING_MATCH_THRESHOLD = 55
