// Agente de chat do CRM: loop de tool-use multi-turno sobre leads/imóveis/
// tarefas. Não estende BaseAgent porque este precisa de tools + multi-turno,
// ao contrário dos outros agentes (single-shot, JSON estruturado).

import Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import { CLAUDE_MODEL } from './base-agent'
import { CHAT_TOOLS, runChatTool } from './chat-tools'

const SYSTEM_PROMPT = `És o assistente do CRM imobiliário do Élsio (RE/MAX, Portugal).
Respondes a perguntas sobre os dados reais do CRM: leads, imóveis (listings) e tarefas.

REGRAS:
- Usa sempre as tools para obter dados — nunca inventes nomes, valores ou ids
- Se uma tool não devolver resultados, diz isso claramente em vez de inventar
- Respostas curtas e directas, em português de Portugal
- Quando fizer sentido, refere números concretos (preços em €, quantidades)
- Não sugiras ações fora do que foi perguntado`

export interface ChatTurnResult {
  text: string
  toolCalls: { name: string; input: unknown }[]
}

const MAX_ITERATIONS = 6

export class ChatAgent {
  private client: Anthropic

  constructor() {
    this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  }

  async ask(
    supabase: SupabaseClient,
    history: { role: 'user' | 'assistant'; content: string }[],
    userMessage: string
  ): Promise<ChatTurnResult> {
    const messages: Anthropic.MessageParam[] = [
      ...history.map((m) => ({ role: m.role, content: m.content }) as Anthropic.MessageParam),
      { role: 'user', content: userMessage },
    ]

    const toolCalls: { name: string; input: unknown }[] = []

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const isLastAllowedIteration = i === MAX_ITERATIONS - 1

      const response = await this.client.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages,
        tools: isLastAllowedIteration ? undefined : CHAT_TOOLS,
      })

      if (response.stop_reason !== 'tool_use') {
        const text = response.content
          .filter((c) => c.type === 'text')
          .map((c) => (c as Anthropic.TextBlock).text)
          .join('')
        return { text: text || 'Não consegui gerar uma resposta.', toolCalls }
      }

      messages.push({ role: 'assistant', content: response.content })

      const toolResults: Anthropic.ToolResultBlockParam[] = []
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue
        toolCalls.push({ name: block.name, input: block.input })
        const result = await runChatTool(supabase, block.name, block.input as Record<string, unknown>)
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(result),
        })
      }
      messages.push({ role: 'user', content: toolResults })
    }

    return { text: 'Demasiados passos para responder a esta pergunta — tenta ser mais específico.', toolCalls }
  }
}

export const chatAgent = new ChatAgent()
