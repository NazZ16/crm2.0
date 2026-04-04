import { BaseAgent, CLAUDE_HAIKU } from './base-agent'

const SYSTEM_PROMPT = `És um coach estratégico de vendas imobiliárias em Portugal.
Analisa o pipeline semanal e identifica padrões e prioridades.

REGRAS:
- Responde SEMPRE em JSON válido, sem texto antes ou depois
- Máximo 3 prioridades
- padrao_semana e alerta podem ser null se não houver dados suficientes

FORMATO JSON:
{
  "prioridades": [
    {
      "lead_name": "string",
      "lead_id": "uuid",
      "razao": "string",
      "acao": "string"
    }
  ],
  "padrao_semana": "string | null",
  "alerta": "string | null",
  "learning": "string — insight accionável para guardar em memória do agente"
}`

export interface MacroReport {
  prioridades: { lead_name: string; lead_id: string; razao: string; acao: string }[]
  padrao_semana: string | null
  alerta: string | null
  learning: string
}

export interface MacroInput {
  openLeads: { id: string; full_name: string; score: number; urgency: number; status: string; last_contact_at: string | null }[]
  wonLeads: { full_name: string; source: string | null }[]
  lostLeads: { full_name: string }[]
  pastLearnings: string[]
}

export class CoachMacroAgent extends BaseAgent {
  async analyze(input: MacroInput): Promise<MacroReport> {
    const { openLeads, wonLeads, lostLeads, pastLearnings } = input

    const week = new Date().toLocaleDateString('pt-PT', { day: 'numeric', month: 'long', year: 'numeric' })

    const userMessage = `SEMANA DE: ${week}

PIPELINE ABERTO (${openLeads.length} leads):
${openLeads.slice(0, 15).map(l => {
  const days = l.last_contact_at
    ? Math.floor((Date.now() - new Date(l.last_contact_at).getTime()) / 86400000)
    : null
  return `- ${l.full_name} (id: ${l.id}) — ${l.status}, score ${l.score}, urgência ${l.urgency}${days != null ? `, ${days}d sem contacto` : ''}`
}).join('\n') || 'Nenhum'}

GANHOS RECENTES: ${wonLeads.map(l => `${l.full_name}${l.source ? ` (${l.source})` : ''}`).join(', ') || 'Nenhum'}
PERDIDOS RECENTES: ${lostLeads.map(l => l.full_name).join(', ') || 'Nenhum'}

${pastLearnings.length > 0 ? `APRENDIZAGENS ANTERIORES:\n${pastLearnings.slice(0, 3).join('\n')}` : ''}`

    const { text } = await this.callClaude(SYSTEM_PROMPT, userMessage, 1500, CLAUDE_HAIKU)
    return this.parseJSON<MacroReport>(text)
  }
}

export const coachMacroAgent = new CoachMacroAgent()
