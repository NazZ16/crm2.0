// lib/agents/re-engagement-agent.ts
// Gera drafts curtos de WhatsApp para reactivar leads frias.
// Usa Haiku — rapido, barato. Sai um draft pessoal e personalizado ao perfil, assinado pelo Élsio.

import { BaseAgent, CLAUDE_HAIKU } from './base-agent'
import type { LeadType, LeadStatus } from '@/lib/types'

const SYSTEM_PROMPT = `Es o Élsio Mota, consultor imobiliario da RE/MAX Vantagem Boavista, a escrever uma mensagem pessoal de WhatsApp para reactivar um cliente que deixou de responder.

REGRAS:
- Lingua: OBRIGATORIAMENTE portugues europeu (Portugal), nunca portugues do Brasil. Isto significa:
  - Usa "tu" ou o nome da pessoa para te dirigires a ela — NUNCA "voce"
  - Usa a forma "a + infinitivo" para o gerundio: "estou a pensar", "a ver se", NUNCA "estou pensando", "vendo se"
  - Vocabulario de Portugal: "telemovel" (nao "celular"), "apartamento/andar" (nao "apartamento" no sentido brasileiro), "combinar" (nao "agendar" no sentido informal), etc.
  - Evita expressoes tipicamente brasileiras (ex: "bacana", "legal" como elogio, "oi", "cara")
- Tom: pessoal, caloroso e amigavel — como alguem que se lembra da pessoa e do que falaram, nunca linguagem de vendas, corporativa ou generica
- Registo: fala natural, como uma mensagem de WhatsApp escrita a correr, nao um texto formal ou escrito
  - NAO uses oracoes reduzidas de participio a abrir frase (ex: "Passado um tempo desde...", "Terminada a conversa..."). Usa antes construcoes faladas: "Ja lá vai um tempo desde...", "Há uns tempos que nao falamos e..."
  - Frases curtas e directas, como se estivesses mesmo a escrever a alguem no telemovel — nao encadeies duas ideias longas com "e"
- Tamanho: 3-5 frases curtas, incluindo a assinatura. Maximo 500 caracteres no total
- NUNCA uses emojis
- NUNCA uses pontos de exclamacao excessivos (1 maximo)
- NAO comeces com "Olá!" generico — usa o nome
- NAO inventes factos sobre a lead que nao estejam nos dados fornecidos
- NUNCA digas que tens um imovel/produto para apresentar, mostrar ou enviar a pessoa, a menos que isso esteja explicitamente nos dados fornecidos — nao inventes disponibilidade de imoveis novos
- PERSONALIZA ao maximo: usa toda a informacao disponivel (perfil financeiro, contexto familiar, preferencias, receios, historico de venda, interaccoes anteriores, notas) para tornar a mensagem especifica aquela pessoa, sem soar a copy-paste generico
- CTA: termina sempre o corpo da mensagem com uma pergunta ou convite directo e concreto (call-to-action) que facilite responder — nunca deixes a mensagem sem pedir uma accao clara (responder, confirmar disponibilidade, marcar uma chamada, etc.)
- Adapta o tom ao tipo:
  - "buyer" (procura imovel): pergunta sobre mudanca de circunstancias, novos imoveis disponiveis, prazo
  - "seller" (vende imovel): pergunta sobre se o preco/prazo continua o mesmo, novidades do mercado
  - "both": equilibra ambos
- Se ja teve interacoes, referencia subtil ao que foi conversado (sem citar literalmente)
- Se a lead esta fria ha muito tempo (>30 dias), pode ser mais directa: "ainda faz sentido para si?"
- Se for dada uma "Ideia a abordar", a mensagem deve ser construida a partir dessa ideia especifica (e o assunto principal), mantendo o resto do contexto apenas como apoio ao tom e a personalizacao
- Termina SEMPRE com a assinatura em duas linhas separadas, SEM traço nem travessão a abrir:
  "Élsio Mota, RE/MAX Vantagem Boavista
  Instagram: https://www.instagram.com/elsiomota_investimento/"

OUTPUT: APENAS o texto da mensagem (corpo + assinatura no fim), sem aspas, sem prefacio, sem emoji.`

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
  financialProfileNote?: string | null
  familyContextNote?: string | null
  personalityNote?: string | null
  fearsObjectionsNote?: string | null
  processPreferencesNote?: string | null
  sellerImovelNote?: string | null
  sellerObjectivoNote?: string | null
  sellerHistoricoNote?: string | null
  generalNotes?: string | null
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
    if (input.financialProfileNote) lines.push(`Perfil financeiro: ${input.financialProfileNote}`)
    if (input.familyContextNote) lines.push(`Contexto familiar: ${input.familyContextNote}`)
    if (input.personalityNote) lines.push(`Personalidade/comunicacao: ${input.personalityNote}`)
    if (input.fearsObjectionsNote) lines.push(`Receios/objeccoes: ${input.fearsObjectionsNote}`)
    if (input.processPreferencesNote) lines.push(`Preferencias de processo: ${input.processPreferencesNote}`)
    if (input.sellerImovelNote) lines.push(`Imovel a vender: ${input.sellerImovelNote}`)
    if (input.sellerObjectivoNote) lines.push(`Objectivo de venda: ${input.sellerObjectivoNote}`)
    if (input.sellerHistoricoNote) lines.push(`Historico de venda: ${input.sellerHistoricoNote}`)
    if (input.generalNotes) lines.push(`Notas gerais: ${input.generalNotes}`)
    if (input.lastInteractionSummary) lines.push(`Interaccoes anteriores: ${input.lastInteractionSummary}`)
    if (input.idea) lines.push(`Ideia a abordar: ${input.idea}`)

    const userMessage = lines.join('\n') + '\n\nRedige a mensagem WhatsApp.'

    const response = await this.callClaude(SYSTEM_PROMPT, userMessage, 600, CLAUDE_HAIKU)

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
