// lib/agents/matching-agent.ts
import { BaseAgent, CLAUDE_HAIKU, PT_PT_LANGUAGE_RULES } from './base-agent'
import type { Investor, Opportunity } from '@/lib/types'
import type { ScoreResult } from '@/lib/matching-engine'

const SYSTEM_PROMPT = `És um consultor imobiliário especializado em investimento em Portugal.
Para cada par investidor-imóvel, escreve um pitch de apresentação curto (3-4 frases).
O pitch deve destacar o que torna este imóvel interessante especificamente para aquele investidor.
Responde SEMPRE em JSON válido com o array "pitches".

O texto de "pitch_draft" segue SEMPRE estas regras:

${PT_PT_LANGUAGE_RULES}`

export interface PitchResult {
  investor_id: string
  pitch_draft: string | null
}

interface PitchesOutput {
  pitches: PitchResult[]
}

class MatchingAgent extends BaseAgent {
  async generatePitches(
    matches: ScoreResult[],
    investors: Investor[],
    opp: Opportunity,
  ): Promise<PitchResult[]> {
    if (matches.length === 0) return []

    const investorMap = new Map(investors.map((i) => [i.id, i]))

    const matchList = matches
      .map((m) => {
        const inv = investorMap.get(m.investor_id)
        if (!inv) return null
        return `Investidor: ${inv.name} | Budget: €${inv.budget_min?.toLocaleString('pt-PT') ?? '?'}-€${inv.budget_max?.toLocaleString('pt-PT') ?? '?'} | Tipos: ${inv.investment_type?.join(', ') ?? 'variado'} | Score: ${m.score}/100 | Razões positivas: ${m.reasons.filter((r) => r.positive).map((r) => r.reason).join('; ')}`
      })
      .filter(Boolean)
      .join('\n')

    const oppSummary = `Imóvel: ${opp.title} | Zona: ${opp.zone} | Tipo: ${opp.deal_type} | Preço: €${(opp.negotiated_price ?? opp.asking_price).toLocaleString('pt-PT')} | Tipologia: ${opp.typology ?? 'N/A'} | Área: ${opp.area_m2 ?? 'N/A'}m²`

    const userMessage = `${oppSummary}\n\nInvestidores para apresentar:\n${matchList}\n\nResponde com:\n{"pitches":[{"investor_id":"uuid","pitch_draft":"texto"}]}`

    try {
      const { text } = await this.callClaude(SYSTEM_PROMPT, userMessage, 1024, CLAUDE_HAIKU)
      const parsed = this.parseJSON<PitchesOutput>(text)
      return parsed.pitches
    } catch (err) {
      console.error('[matching-agent] Falha ao gerar pitches:', err)
      return matches.map((m) => ({ investor_id: m.investor_id, pitch_draft: null }))
    }
  }
}

const matchingAgent = new MatchingAgent()

export async function generatePitches(
  matches: ScoreResult[],
  investors: Investor[],
  opp: Opportunity,
): Promise<PitchResult[]> {
  return matchingAgent.generatePitches(matches, investors, opp)
}
