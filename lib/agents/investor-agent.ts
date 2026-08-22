import { BaseAgent, PT_PT_LANGUAGE_RULES } from './base-agent'
import type { Investor, Opportunity, RoiMetrics } from '@/lib/types'
import { calcularRoi, formatEur, formatPct } from '@/lib/roi-calculator'

export interface InvestorMatchResult {
  investor_id: string
  score: number                          // 0-100
  reasons: { reason: string; positive: boolean }[]
  concerns: string[]
  pitch_draft: string
  recommended_action: string
}

export interface InvestorAgentOutput {
  matches: InvestorMatchResult[]
  best_match_id: string | null
  opportunity_summary: string
  analysis_notes: string
}

const SYSTEM_PROMPT = `És um consultor especializado em investimento imobiliário em Portugal.
A tua missão é analisar oportunidades de investimento e fazer match com o perfil de cada investidor.

REGRAS:
- Responde SEMPRE em JSON válido, sem texto antes ou depois
- Sê objetivo e factual — baseia o score nas métricas reais
- O score vai de 0 (não adequado) a 100 (match perfeito)
- Os pitches devem ser diretos, profissionais mas não formais
- Nunca inventes dados — usa apenas o que é fornecido
- O texto de "pitch_draft" segue SEMPRE estas regras:

${PT_PT_LANGUAGE_RULES}

CRITÉRIOS DE MATCHING:
- Orçamento (peso 30%): preço dentro do range min-max do investidor
- Zona (peso 25%): zona do imóvel na lista de zonas preferidas
- Yield (peso 25%): yield bruto >= yield mínimo do investidor
- Tipologia (peso 10%): tipologia na lista de tipologias preferidas
- Renovação (peso 10%): nível de obras <= máximo aceitável pelo investidor

FORMATO JSON OBRIGATÓRIO:
{
  "matches": [
    {
      "investor_id": "<uuid>",
      "score": <0-100>,
      "reasons": [
        { "reason": "Orçamento dentro do range (€250k, max €300k)", "positive": true },
        { "reason": "Zona Lisboa na lista de preferências", "positive": true },
        { "reason": "Yield 4.8% abaixo do mínimo 5% exigido", "positive": false }
      ],
      "concerns": ["Necessita financiamento — pode atrasar processo"],
      "pitch_draft": "Olá [Nome], sei que procura investimento em Lisboa com bom yield. Tenho um T2 em Alvalade por €249k com renda estimada de €1.100/mês — yield bruto de 5.3%. Posso enviar mais detalhes?",
      "recommended_action": "Contactar hoje — perfil ideal, budget e zona alinhados"
    }
  ],
  "best_match_id": "<uuid do melhor match ou null>",
  "opportunity_summary": "T2 em Lisboa, Alvalade — €249.000 — Yield Bruto 5.3% — Yield Líquido 3.8%",
  "analysis_notes": "Oportunidade sólida para perfis buy-to-let. Zona em valorização..."
}`

function describeRenovation(level: string): string {
  const map: Record<string, string> = {
    none: 'sem obras',
    light: 'obras ligeiras',
    medium: 'obras médias',
    full: 'remodelação total',
  }
  return map[level] ?? level
}

function describeHorizon(h: string): string {
  const map: Record<string, string> = {
    short: 'curto prazo (<2 anos)',
    medium: 'médio prazo (2-5 anos)',
    long: 'longo prazo (>5 anos)',
  }
  return map[h] ?? h
}

export class InvestorAgent extends BaseAgent {
  async run(
    opportunity: Opportunity,
    investors: Investor[]
  ): Promise<{ output: InvestorAgentOutput; tokensUsed: number }> {
    const roi = calcularRoi(opportunity)
    const oppText = this.formatOpportunity(opportunity, roi)
    const investorsText = investors.map((inv) => this.formatInvestor(inv)).join('\n\n---\n\n')

    const userMessage = `
## OPORTUNIDADE A ANALISAR

${oppText}

## INVESTIDORES EM BASE DE DADOS (${investors.length} investidores ativos)

${investorsText}

Analisa a oportunidade e faz match com cada investidor. Retorna o JSON com todos os matches ordenados por score descendente.
    `.trim()

    const { text, inputTokens, outputTokens } = await this.callClaude(
      SYSTEM_PROMPT,
      userMessage,
      6000
    )

    const output = this.parseJSON<InvestorAgentOutput>(text)
    return { output, tokensUsed: inputTokens + outputTokens }
  }

  private formatOpportunity(opp: Opportunity, roi: RoiMetrics): string {
    const preco = opp.negotiated_price ?? opp.asking_price
    const lines = [
      `Título: ${opp.title}`,
      `Zona: ${opp.zone}${opp.address ? ` (${opp.address})` : ''}`,
      `Tipologia: ${opp.typology ?? 'N/D'} | Tipo: ${opp.property_type}`,
      `Preço pedido: ${formatEur(opp.asking_price)}${opp.negotiated_price ? ` → Negociado: ${formatEur(opp.negotiated_price)}` : ''}`,
      ``,
      `── MÉTRICAS ROI ──`,
      `Renda estimada: ${opp.estimated_monthly_rent ? `${formatEur(opp.estimated_monthly_rent)}/mês` : 'N/D'}`,
      `Yield Bruto: ${roi.yield_bruto > 0 ? formatPct(roi.yield_bruto) : 'N/D'}`,
      `Yield Líquido: ${roi.yield_liquido > 0 ? formatPct(roi.yield_liquido) : 'N/D'}`,
      `Encargos anuais: ${formatEur(roi.encargos_anuais)} (condomínio + IMI + gestão)`,
      `Cash Flow Anual: ${roi.cash_flow_anual >= 0 ? formatEur(roi.cash_flow_anual) : `-${formatEur(Math.abs(roi.cash_flow_anual))}`}`,
      `Payback: ${roi.payback_anos ? `${roi.payback_anos} anos` : 'N/D'}`,
      `IMT estimado: ${formatEur(roi.imt)}`,
      `Custos escritura: ${formatEur(roi.custos_escritura)}`,
      `Capital total necessário: ${formatEur(roi.capital_total_investido)}`,
      roi.plus_valia_estimada ? `Mais-valia estimada: ${formatPct(roi.plus_valia_estimada)} (se venda a ${formatEur(opp.estimated_sell_price!)})` : '',
      ``,
      `Custo obras: ${opp.renovation_cost ? formatEur(opp.renovation_cost) : 'Sem obras'}`,
      `Fonte: ${opp.source ?? 'N/D'}`,
      opp.description ? `Descrição: ${opp.description}` : '',
    ].filter(Boolean)

    return lines.join('\n')
  }

  private formatInvestor(inv: Investor): string {
    const lines = [
      `ID: ${inv.id}`,
      `Nome: ${inv.name}`,
      `Orçamento: ${inv.budget_min ? formatEur(inv.budget_min) : '?'} – ${inv.budget_max ? formatEur(inv.budget_max) : '?'}`,
      `Zonas preferidas: ${inv.preferred_zones.length ? inv.preferred_zones.join(', ') : 'Sem preferência'}`,
      `Tipologias: ${inv.preferred_typologies.length ? inv.preferred_typologies.join(', ') : 'Sem preferência'}`,
      `Yield mínimo: ${inv.min_yield ? formatPct(inv.min_yield) : 'N/D'}`,
      `Tipo de investimento: ${inv.investment_type.join(', ') || 'N/D'}`,
      `Risco: ${inv.risk_level} | Horizonte: ${describeHorizon(inv.investment_horizon)}`,
      `Obras máx aceites: ${describeRenovation(inv.max_renovation)}`,
      `Necessita financiamento: ${inv.needs_financing ? 'Sim' : 'Não'}`,
      inv.notes ? `Notas: ${inv.notes}` : '',
    ].filter(Boolean)

    return lines.join('\n')
  }
}
