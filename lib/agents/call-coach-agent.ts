import { BaseAgent, CLAUDE_HAIKU } from './base-agent'

const SYSTEM_PROMPT = `És um coach de vendas imobiliárias especializado em Portugal.
Analisa a transcrição da chamada e dá feedback objetivo ao consultor — tanto sobre a conversa como sobre o script.

REGRAS:
- Responde APENAS em JSON válido, sem texto antes ou depois
- Sê específico — menciona momentos concretos da chamada quando possível
- Se a chamada for curta ou sem muito conteúdo, adapta o feedback ao que existe
- Não uses vírgulas a seguir ao último elemento de arrays ou objetos

FORMATO JSON:
{
  "sentimento_lead": "muito_interessado" | "interessado" | "neutro" | "hesitante" | "desinteressado",
  "pontos_positivos": ["o que o consultor fez bem — máx 3"],
  "a_melhorar": ["o que pode melhorar — máx 3"],
  "proxima_chamada": "foco concreto para a próxima chamada",
  "script_analise": {
    "abertura": "avaliação da abertura — como se apresentou, criou rapport",
    "descoberta": "avaliação das perguntas de descoberta — o que perguntou, o que faltou",
    "objecoes": "como tratou objeções — preço, timing, concorrência",
    "fecho": "como terminou a chamada — próximos passos claros?",
    "perguntas_sugeridas": [
      "Pergunta que devia ter feito mas não fez — máx 4"
    ],
    "frases_a_evitar": [
      "Frase ou abordagem que não funciona bem — máx 2"
    ],
    "nota_script": <1-10>
  }
}`

export interface ScriptAnalise {
  abertura: string
  descoberta: string
  objecoes: string
  fecho: string
  perguntas_sugeridas: string[]
  frases_a_evitar: string[]
  nota_script: number
}

export interface CoachFeedback {
  sentimento_lead: string
  pontos_positivos: string[]
  a_melhorar: string[]
  proxima_chamada: string
  script_analise: ScriptAnalise
}

export class CallCoachAgent extends BaseAgent {
  async analyze(
    transcript: string,
    leadName: string,
    recentInteractionSummaries: string[]
  ): Promise<CoachFeedback> {
    const history =
      recentInteractionSummaries.length > 0
        ? `\n\nHISTÓRICO RECENTE (últimas ${recentInteractionSummaries.length} interações):\n${recentInteractionSummaries.join('\n')}`
        : ''

    const userMessage = `LEAD: ${leadName}${history}\n\nTRANSCRIÇÃO DA CHAMADA:\n${transcript}`

    const { text } = await this.callClaude(SYSTEM_PROMPT, userMessage, 1500, CLAUDE_HAIKU)
    return this.parseJSON<CoachFeedback>(text)
  }
}

export const callCoachAgent = new CallCoachAgent()
