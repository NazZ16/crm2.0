import { BaseAgent, CLAUDE_HAIKU } from './base-agent'

const SYSTEM_PROMPT = `És o assistente orientador de um consultor imobiliário em Portugal.
O teu trabalho é criar um briefing diário claro e accionável baseado nos dados do CRM.

REGRAS:
- Responde SEMPRE em JSON válido, sem texto antes ou depois
- Máximo 3 items por lista
- Sê direto e específico — nomes reais, números reais
- Apenas inclui 'coach_insight' se existirem dados de learnings

FORMATO JSON:
{
  "urgentes": [
    { "lead_name": "string", "lead_id": "uuid", "razao": "string", "acao": "string" }
  ],
  "esta_semana": [
    { "item": "string", "detalhe": "string" }
  ],
  "coach_insight": "string | null"
}`

export interface OrientatorBriefing {
  urgentes: { lead_name: string; lead_id: string; razao: string; acao: string }[]
  esta_semana: { item: string; detalhe: string }[]
  coach_insight: string | null
}

export interface OrientatorInput {
  urgentLeads: { id: string; full_name: string; score: number; last_contact_at: string | null; urgency: number }[]
  tasksDueToday: { title: string; lead_id: string | null }[]
  coldLeadsCount: number
  openMatchesCount: number
  coachLearning: string | null
}

export class OrientatorAgent extends BaseAgent {
  async generateBriefing(input: OrientatorInput): Promise<OrientatorBriefing> {
    const { urgentLeads, tasksDueToday, coldLeadsCount, openMatchesCount, coachLearning } = input

    const today = new Date().toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long' })

    const userMessage = `DATA: ${today}

LEADS URGENTES (urgência >= 3 ou score >= 70):
${urgentLeads.slice(0, 5).map(l => {
  const daysSince = l.last_contact_at
    ? Math.floor((Date.now() - new Date(l.last_contact_at).getTime()) / 86400000)
    : null
  return `- ${l.full_name} (id: ${l.id}) — score ${l.score}, urgência ${l.urgency}${daysSince != null ? `, sem contacto há ${daysSince} dias` : ''}`
}).join('\n') || 'Nenhuma'}

TAREFAS PARA HOJE: ${tasksDueToday.length}
${tasksDueToday.slice(0, 3).map(t => `- ${t.title}`).join('\n') || 'Nenhuma'}

LEADS FRIAS (>7 dias sem contacto): ${coldLeadsCount}
MATCHES DE IMÓVEIS POR REVER: ${openMatchesCount}

${coachLearning ? `LEARNING DO COACH:\n${coachLearning}` : ''}`

    const { text } = await this.callClaude(SYSTEM_PROMPT, userMessage, 500, CLAUDE_HAIKU)
    return this.parseJSON<OrientatorBriefing>(text)
  }
}

export const orientatorAgent = new OrientatorAgent()
