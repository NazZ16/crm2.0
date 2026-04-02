// lib/agents/matching-agent.ts
import Anthropic from '@anthropic-ai/sdk'
import type { Investor, Opportunity } from '@/lib/types'
import type { ScoreResult } from '@/lib/matching-engine'

const HAIKU_MODEL = 'claude-haiku-4-5-20251001'

const SYSTEM_PROMPT = `És um consultor imobiliário especializado em investimento em Portugal.
Para cada par investidor-imóvel, escreve um pitch de apresentação curto (3-4 frases) em português de Portugal.
O pitch deve destacar o que torna este imóvel interessante especificamente para aquele investidor.
Responde SEMPRE em JSON válido com o array "pitches".`

export interface PitchResult {
  investor_id: string
  pitch_draft: string
}

export async function generatePitches(
  matches: ScoreResult[],
  investors: Investor[],
  opp: Opportunity,
): Promise<PitchResult[]> {
  if (matches.length === 0) return []

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
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

  const response = await client.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  })

  const text = response.content
    .filter((c) => c.type === 'text')
    .map((c) => (c as { type: 'text'; text: string }).text)
    .join('')

  try {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    const parsed = JSON.parse(text.slice(start, end + 1)) as { pitches: PitchResult[] }
    return parsed.pitches
  } catch {
    console.error('[matching-agent] Falha ao fazer parse dos pitches:', text)
    return matches.map((m) => ({ investor_id: m.investor_id, pitch_draft: '' }))
  }
}
