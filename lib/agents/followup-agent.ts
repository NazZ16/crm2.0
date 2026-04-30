import { BaseAgent } from './base-agent'
import type { FollowupPlan, FollowupPlanItem } from '@/lib/types'

const SYSTEM_PROMPT = `Es um assistente de gestao de leads imobiliarias em Portugal.
A tua tarefa e analisar o estado atual das leads abertas e criar um plano de follow-up diario.

REGRAS:
- Prioriza leads com maior urgencia e mais dias sem contacto
- Considera a etapa no funil (new < qualified < meeting < active)
- Deteta leads "frias" (sem contacto ha mais de 7 dias)
- Sugere acoes concretas e rascunhos de mensagem curtos
- Responde SEMPRE em JSON valido, sem texto antes ou depois, sem markdown fences

REGRAS CRITICAS DE FORMATO JSON:
- NAO uses aspas duplas (") dentro dos valores das strings. Se precisares de citar algo, usa aspas simples (').
- NAO uses quebras de linha (\\n) dentro de strings; mantem cada string numa linha so.
- Limita o draft_message a ~200 caracteres (frases curtas).
- Maximo 8 items no array.

FORMATO JSON:
{
  "date": "YYYY-MM-DD",
  "items": [
    {
      "lead_id": "uuid",
      "lead_name": "Nome",
      "reason": "Porque contactar hoje",
      "action": "O que fazer",
      "priority": "urgent | high | medium | low",
      "draft_message": "Ola [Nome], ...",
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

Cria o plano de follow-up para hoje. Inclui no maximo as top 8 prioridades.
Deteta todas as leads sem contacto ha mais de 7 dias na lista cold_leads.`

    const { text } = await this.callClaude(SYSTEM_PROMPT, userMessage, 4096)
    return this.parseJSON<FollowupPlan>(text)
  }
}

export const followupAgent = new FollowupAgent()
