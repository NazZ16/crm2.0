import { BaseAgent, CLAUDE_HAIKU } from './base-agent'

const SYSTEM_PROMPT = `És um coach de vendas imobiliárias especializado em Portugal.
Analisa transcrições de chamadas e dá feedback objetivo e construtivo ao consultor.

REGRAS:
- Responde SEMPRE em JSON válido, sem texto antes ou depois
- Sê específico — menciona momentos concretos da chamada
- Máximo 3 pontos em cada lista
- sentimento_lead: 'muito_interessado' | 'interessado' | 'neutro' | 'hesitante' | 'desinteressado'

FORMATO JSON:
{
  "pontos_positivos": ["string"],
  "a_melhorar": ["string"],
  "proxima_chamada": "string — o que focar na próxima chamada",
  "sentimento_lead": "string"
}`

export interface CoachFeedback {
  pontos_positivos: string[]
  a_melhorar: string[]
  proxima_chamada: string
  sentimento_lead: string
}

export class CallCoachAgent extends BaseAgent {
  async analyze(
    transcript: string,
    leadName: string,
    recentInteractionSummaries: string[]
  ): Promise<CoachFeedback> {
    const history = recentInteractionSummaries.length > 0
      ? `\n\nHISTÓRICO RECENTE (últimas ${recentInteractionSummaries.length} interações):\n${recentInteractionSummaries.join('\n')}`
      : ''

    const userMessage = `LEAD: ${leadName}${history}\n\nTRANSCRIÇÃO DA CHAMADA:\n${transcript}`

    const { text } = await this.callClaude(SYSTEM_PROMPT, userMessage, 800, CLAUDE_HAIKU)
    return this.parseJSON<CoachFeedback>(text)
  }
}

export const callCoachAgent = new CallCoachAgent()
