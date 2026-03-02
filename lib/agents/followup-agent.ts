import { BaseAgent } from './base-agent'
import type { FollowupPlan, FollowupPlanItem } from '@/lib/types'

const SYSTEM_PROMPT = `És um assistente de gestão de leads imobiliárias em Portugal.
A tua tarefa é analisar o estado atual das leads abertas e criar um plano de follow-up diário.

REGRAS:
- Prioriza leads com maior urgência e mais dias sem contacto
- Considera a etapa no funil (new < qualified < meeting < active)
- Deteta leads "frias" (sem contacto há mais de 7 dias)
- Sugere ações concretas e rascunhos de mensagem curtos
- Responde SEMPRE em JSON válido

FORMATO JSON:
{
  "date": "YYYY-MM-DD",
  "items": [
    {
      "lead_id": "uuid",
      "lead_name": "Nome",
      "reason": "Porquê contactar hoje",
      "action": "O que fazer",
      "priority": "urgent" | "high" | "medium" | "low",
      "draft_message": "Olá [Nome], ...",
      "days_since_contact": 3
    }
  ],
  "cold_leads": ["uuid1", "uuid2"],
  "summary": "Resumo do dia: X leads para contactar, Y leads frias"
}`

export interface LeadSummary {
  id: string
  full_name: string
  status: string
  urgency: number
  score: number
  days_since_contact: number
  last_interaction_summary?: string
  next_action_description?: string
}

export class FollowupAgent extends BaseAgent {
  async generatePlan(leads: LeadSummary[], date: string): Promise<FollowupPlan> {
    if (leads.length === 0) {
      return {
        date,
        items: [] as FollowupPlanItem[],
        cold_leads: [],
        summary: 'Sem leads abertas para hoje.',
      }
    }

    const userMessage = `DATA DE HOJE: ${date}

LEADS ABERTAS (${leads.length} total):
${JSON.stringify(leads, null, 2)}

Cria o plano de follow-up para hoje. Inclui no máximo as top 10 prioridades.
Deteta todas as leads sem contacto há mais de 7 dias na lista cold_leads.`

    const { text } = await this.callClaude(SYSTEM_PROMPT, userMessage, 2048)
    return this.parseJSON<FollowupPlan>(text)
  }
}

export const followupAgent = new FollowupAgent()
