import { BaseAgent } from './base-agent'

const SYSTEM_PROMPT = `És um especialista em marketing digital e publicidade imobiliária em Portugal.
Analisa métricas de campanhas de publicidade e fornece recomendações accionáveis.

REGRAS:
- Calcula CPL (custo por lead), CTR, taxa de conversão para cada campanha
- Compara performance entre plataformas e campanhas
- Identifica campanhas com ROI negativo
- Recomenda redistribuição de budget de forma concreta (em %)
- Responde SEMPRE em JSON válido

FORMATO JSON:
{
  "campaign_analysis": [
    {
      "campaign_id": "uuid",
      "campaign_name": "Nome",
      "platform": "meta" | "google" | "tiktok",
      "cpl": 45.50,
      "ctr_pct": 2.3,
      "conversion_rate_pct": 4.5,
      "performance_rating": "excellent" | "good" | "average" | "poor",
      "insights": ["insight 1"]
    }
  ],
  "top_performing": "uuid da melhor campanha",
  "worst_performing": "uuid da pior campanha",
  "budget_recommendations": [
    {
      "campaign_id": "uuid",
      "action": "increase" | "decrease" | "pause" | "maintain",
      "change_pct": 20,
      "reason": "porquê"
    }
  ],
  "overall_insights": ["insight geral 1"],
  "attribution_notes": "nota sobre atribuição de leads"
}`

export interface CampaignData {
  id: string
  name: string
  platform: string
  budget_daily: number | null
  total_spend: number
  total_impressions: number
  total_clicks: number
  total_leads: number
  total_conversions: number
  period_days: number
}

export interface MarketingAnalysis {
  campaign_analysis: Array<{
    campaign_id: string
    campaign_name: string
    platform: string
    cpl: number
    ctr_pct: number
    conversion_rate_pct: number
    performance_rating: 'excellent' | 'good' | 'average' | 'poor'
    insights: string[]
  }>
  top_performing: string
  worst_performing: string
  budget_recommendations: Array<{
    campaign_id: string
    action: 'increase' | 'decrease' | 'pause' | 'maintain'
    change_pct: number
    reason: string
  }>
  overall_insights: string[]
  attribution_notes: string
}

export class MarketingAgent extends BaseAgent {
  async analyzeCampaigns(campaigns: CampaignData[]): Promise<MarketingAnalysis> {
    if (campaigns.length === 0) {
      return {
        campaign_analysis: [],
        top_performing: '',
        worst_performing: '',
        budget_recommendations: [],
        overall_insights: ['Sem dados de campanhas para analisar.'],
        attribution_notes: '',
      }
    }

    const userMessage = `DADOS DAS CAMPANHAS (últimos 30 dias):
${JSON.stringify(campaigns, null, 2)}

Analisa a performance e fornece recomendações concretas de otimização.`

    const { text } = await this.callClaude(SYSTEM_PROMPT, userMessage, 2048)
    return this.parseJSON<MarketingAnalysis>(text)
  }
}

export const marketingAgent = new MarketingAgent()
