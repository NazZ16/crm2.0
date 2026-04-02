// lib/matching-engine.ts
// Scoring determinístico: zero chamadas Claude, zero custo de tokens.

import type { Investor, Opportunity } from './types'

export interface ScoreResult {
  investor_id: string
  score: number       // 0-100
  reasons: Array<{ reason: string; positive: boolean }>
  passes_hard_filter: boolean
}

const RENOVATION_ORDER = ['none', 'light', 'medium', 'full'] as const
type RenovationLevel = typeof RENOVATION_ORDER[number]

function renovationFits(
  oppCost: number,
  maxRenovation: RenovationLevel,
): boolean {
  if (maxRenovation === 'full') return true
  if (maxRenovation === 'none') return oppCost === 0
  if (maxRenovation === 'light') return oppCost <= 15_000
  if (maxRenovation === 'medium') return oppCost <= 50_000
  return true
}

function estimatedYield(opp: Opportunity): number | null {
  if (!opp.estimated_monthly_rent || !opp.asking_price) return null
  return ((opp.estimated_monthly_rent * 12) / opp.asking_price) * 100
}

export function scoreMatch(investor: Investor, opp: Opportunity): ScoreResult {
  const reasons: Array<{ reason: string; positive: boolean }> = []
  let score = 0

  const price = opp.negotiated_price ?? opp.asking_price

  // Hard filter: Budget
  if (investor.budget_min && price < investor.budget_min) {
    return { investor_id: investor.id, score: 0, reasons: [{ reason: 'Preço abaixo do budget mínimo', positive: false }], passes_hard_filter: false }
  }
  if (investor.budget_max && price > investor.budget_max) {
    return { investor_id: investor.id, score: 0, reasons: [{ reason: 'Preço acima do budget máximo', positive: false }], passes_hard_filter: false }
  }

  // Hard filter: Zona
  if (investor.preferred_zones && investor.preferred_zones.length > 0) {
    const zoneMatch = investor.preferred_zones.some(
      (z) => opp.zone.toLowerCase().includes(z.toLowerCase())
    )
    if (!zoneMatch) {
      return { investor_id: investor.id, score: 0, reasons: [{ reason: `Zona ${opp.zone} fora das preferências`, positive: false }], passes_hard_filter: false }
    }
  }

  // Hard filter: Tipologia
  if (investor.preferred_typologies && investor.preferred_typologies.length > 0 && opp.typology) {
    const typoMatch = investor.preferred_typologies.includes(opp.typology)
    if (!typoMatch) {
      return { investor_id: investor.id, score: 0, reasons: [{ reason: `Tipologia ${opp.typology} fora das preferências`, positive: false }], passes_hard_filter: false }
    }
  }

  // Soft: Yield (30 pts)
  const yld = estimatedYield(opp)
  if (yld !== null && investor.min_yield) {
    if (yld >= investor.min_yield) {
      score += 30
      reasons.push({ reason: `Yield estimado ${yld.toFixed(1)}% ≥ mínimo ${investor.min_yield}%`, positive: true })
    } else {
      reasons.push({ reason: `Yield estimado ${yld.toFixed(1)}% abaixo do mínimo ${investor.min_yield}%`, positive: false })
    }
  } else if (yld !== null) {
    score += 15
    reasons.push({ reason: `Yield estimado ${yld.toFixed(1)}%`, positive: true })
  }

  // Soft: Zona (20 pts)
  if (investor.preferred_zones && investor.preferred_zones.length > 0) {
    const exactZone = investor.preferred_zones.some(
      (z) => opp.zone.toLowerCase() === z.toLowerCase()
    )
    if (exactZone) {
      score += 20
      reasons.push({ reason: `Zona ${opp.zone} é zona preferida`, positive: true })
    } else {
      score += 10
      reasons.push({ reason: `Zona ${opp.zone} dentro das zonas aceites`, positive: true })
    }
  } else {
    score += 10
    reasons.push({ reason: 'Investor aceita qualquer zona', positive: true })
  }

  // Soft: Tipologia (15 pts)
  if (investor.preferred_typologies && investor.preferred_typologies.length > 0 && opp.typology) {
    score += 15
    reasons.push({ reason: `Tipologia ${opp.typology} é preferida`, positive: true })
  } else if (!investor.preferred_typologies?.length) {
    score += 8
    reasons.push({ reason: 'Investor aceita qualquer tipologia', positive: true })
  }

  // Soft: Budget position (10 pts)
  if (investor.budget_min && investor.budget_max) {
    const range = investor.budget_max - investor.budget_min
    const position = (price - investor.budget_min) / range
    if (position <= 0.33) {
      score += 10
      reasons.push({ reason: 'Preço no terço inferior do budget (boa margem)', positive: true })
    }
  }

  // Soft: Deal type (15 pts)
  if (investor.investment_type && investor.investment_type.length > 0 && opp.deal_type) {
    const dealTypeMap: Record<string, string[]> = {
      buy_to_let: ['buy_to_let'],
      fix_and_flip: ['fix_and_flip', 'buy_to_sell'],
    }
    const compatibleTypes = dealTypeMap[opp.deal_type] ?? [opp.deal_type]
    const dealMatch = investor.investment_type.some((t) => compatibleTypes.includes(t))
    if (dealMatch) {
      score += 15
      reasons.push({ reason: `Deal type ${opp.deal_type} alinhado com perfil do investor`, positive: true })
    } else {
      reasons.push({ reason: `Deal type ${opp.deal_type} não é o preferido`, positive: false })
    }
  } else {
    score += 8
  }

  // Soft: Renovação (10 pts)
  const renovCost = opp.renovation_cost + opp.construction_cost
  const fits = renovationFits(renovCost, investor.max_renovation as RenovationLevel)
  if (fits) {
    score += 10
    reasons.push({ reason: 'Obras dentro do nível aceite pelo investor', positive: true })
  } else {
    reasons.push({ reason: 'Obras acima do nível aceite pelo investor', positive: false })
  }

  return {
    investor_id: investor.id,
    score: Math.min(score, 100),
    reasons,
    passes_hard_filter: true,
  }
}

export function scoreAllInvestors(
  investors: Investor[],
  opp: Opportunity,
  threshold = 50,
): ScoreResult[] {
  return investors
    .map((inv) => scoreMatch(inv, opp))
    .filter((r) => r.passes_hard_filter && r.score >= threshold)
    .sort((a, b) => b.score - a.score)
}
