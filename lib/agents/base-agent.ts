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
    const MAX_RETRIES = 4
    const BASE_DELAY_MS = 2000

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
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
      } catch (err) {
        const isOverloaded =
          err instanceof Anthropic.APIError && (err.status === 529 || err.status === 529)
        const isRateLimit =
          err instanceof Anthropic.APIError && err.status === 429
        const shouldRetry = (isOverloaded || isRateLimit) && attempt < MAX_RETRIES

        if (!shouldRetry) throw err

        // Backoff exponencial: 2s, 4s, 8s, 16s
        const delay = BASE_DELAY_MS * Math.pow(2, attempt)
        await new Promise((r) => setTimeout(r, delay))
      }
    }

    throw new Error('Anthropic API indisponível após várias tentativas')
  }

  protected parseJSON<T>(text: string): T {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start === -1 || end === -1) {
      throw new Error(`Nenhum JSON encontrado na resposta do agente. Raw: ${text.slice(0, 200)}`)
    }

    const raw = text.slice(start, end + 1)

    // Tentativa 1: parse direto
    try {
      return JSON.parse(raw) as T
    } catch { /* continuar */ }

    // Tentativa 2: remover vírgulas antes de } ou ]
    try {
      const cleaned = raw.replace(/,(\s*[}\]])/g, '$1')
      return JSON.parse(cleaned) as T
    } catch { /* continuar */ }

    // Tentativa 3: truncar no último campo completo e fechar o objeto
    try {
      const lastComma = raw.lastIndexOf(',')
      const lastQuote = raw.lastIndexOf('"')
      const cutAt = Math.max(lastComma, lastQuote)
      if (cutAt > start) {
        // Fechar todos os arrays/objetos abertos
        const partial = raw.slice(0, cutAt)
        const opens = (partial.match(/\[/g) ?? []).length - (partial.match(/\]/g) ?? []).length
        const closing = ']'.repeat(Math.max(0, opens)) + '}'
        return JSON.parse(partial + closing) as T
      }
    } catch { /* continuar */ }

    throw new Error(`JSON inválido na resposta do agente. Posição aprox. ${raw.length} chars. Início: ${raw.slice(0, 100)}`)
  }
}
