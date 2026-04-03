import Anthropic from '@anthropic-ai/sdk'

export const CLAUDE_MODEL = 'claude-sonnet-4-6'
export const CLAUDE_HAIKU = 'claude-haiku-4-5-20251001'

export abstract class BaseAgent {
  protected client: Anthropic

  constructor() {
    this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  }

  protected async callClaude(
    systemPrompt: string,
    userMessage: string,
    maxTokens = 4096,
    model = CLAUDE_MODEL
  ): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
    const response = await this.client.messages.create({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    })

    const text = response.content
      .filter((c) => c.type === 'text')
      .map((c) => (c as { type: 'text'; text: string }).text)
      .join('')

    return {
      text,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    }
  }

  protected parseJSON<T>(text: string): T {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start === -1 || end === -1) {
      throw new Error('Nenhum JSON encontrado na resposta do agente')
    }
    return JSON.parse(text.slice(start, end + 1)) as T
  }
}
