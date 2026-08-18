// lib/agents/re-engagement-agent.ts
// Gera drafts curtos de WhatsApp para reactivar leads frias.
// Usa Haiku — rapido, barato. Sai um draft de 1-3 frases personalizado ao perfil.

import { BaseAgent, CLAUDE_HAIKU } from './base-agent'
import type { LeadType, LeadStatus } from '@/lib/types'

const SYSTEM_PROMPT = `Es um consultor imobiliario portugues experiente, a redigir uma mensagem curta de WhatsApp para reactivar um cliente que deixou de responder.

REGRAS:
- Lingua: portugues europeu (Portugal), tom natural e directo, sem floreados
- Tamanho: 2-4 frases curtas. Maximo 250 caracteres
- NUNCA uses emojis
- NUNCA uses pontos de exclamacao excessivos (1 maximo)
- NAO comeces com "Olá!" generico — usa o nome
- NAO inventes factos sobre a lead que nao estejam nos dados
- O objectivo e que respondam: faz uma pergunta concreta no fim
- Adapta o tom ao tipo:
  - "buyer" (procura imovel): pergunta sobre mudanca de circunstancias, novos imoveis disponiveis, prazo
  - "seller" (vende imovel): pergunta sobre se o preco/prazo continua o mesmo, novidades do mercado
  - "both": equilibra ambos
- Se ja teve interacoes, referencia subtil ao que foi conversado (sem citar literalmente)
- Se a lead esta fria ha muito tempo (>30 dias), pode ser mais directa: "ainda faz sentido para si?"
- Se for dada uma "Ideia a abordar", a mensagem deve ser construida a partir dessa ideia especifica (é o assunto principal), mantendo o resto do contexto apenas como apoio ao tom

OUTPUT: APENAS o texto da mensagem, sem aspas, sem prefacio, sem emoji, sem assinatura. Apenas o body do WhatsApp.`

export interface ReEngagementInput {
  leadName: string
  leadType: LeadType
  status: LeadStatus
  daysIdle: number
  score: number
  urgency: number
  summary: string | null
  lastInteractionSummary: string | null
  homePreferencesNote?: string | null
  sellerImovelNote?: string | null
  idea?: string | null
}

export class ReEngagementAgent extends BaseAgent {
  async generate(input: ReEngagementInput): Promise<{ body: string; tokensUsed: number }> {
    const lines = [
      `Lead: ${input.leadName}`,
      `Tipo: ${input.leadType}`,
      `Status actual: ${input.status}`,
      `Dias sem contacto: ${input.daysIdle}`,
      `Score: ${input.score}/100, urgencia ${input.urgency}/5`,
    ]
    if (input.summary) lines.push(`Resumo do perfil: ${input.summary}`)
    if (input.homePreferencesNote) lines.push(`Procura: ${input.homePreferencesNote}`)
    if (input.sellerImovelNote) lines.push(`Imovel a vender: ${input.sellerImovelNote}`)
    if (input.lastInteractionSummary) lines.push(`Ultima interaccao: ${input.lastInteractionSummary}`)
    if (input.idea) lines.push(`Ideia a abordar: ${input.idea}`)

    const userMessage = lines.join('\n') + '\n\nRedige a mensagem WhatsApp.'

    const response = await this.callClaude(SYSTEM_PROMPT, userMessage, 400, CLAUDE_HAIKU)

    // Limpeza: remove aspas exteriores se vierem, remove leading/trailing whitespace
    let body = response.text.trim()
    if ((body.startsWith('"') && body.endsWith('"')) || (body.startsWith('“') && body.endsWith('”'))) {
      body = body.slice(1, -1).trim()
    }

    return {
      body,
      tokensUsed: response.inputTokens + response.outputTokens,
    }
  }
}

export const reEngagementAgent = new ReEngagementAgent()
