import Anthropic from '@anthropic-ai/sdk'

export const CLAUDE_MODEL = 'claude-sonnet-5'
export const CLAUDE_HAIKU = 'claude-haiku-4-5-20251001'

// Regras de lingua partilhadas por todos os agentes que escrevem texto
// dirigido a um lead ou investidor (mensagens, pitches, emails). Evita que
// saia portugues do Brasil ou emojis nalgum dos pontos de contacto.
export const PT_PT_LANGUAGE_RULES = `LINGUA (obrigatorio em qualquer texto dirigido a um lead ou investidor):
- Portugues europeu (Portugal), NUNCA portugues do Brasil
- Usa "tu" ou o nome da pessoa para te dirigires a ela — NUNCA "voce"
- Usa a forma "a + infinitivo" para o gerundio: "estou a pensar", "a ver se" — NUNCA "estou pensando", "vendo se"
- Vocabulario de Portugal: "telemovel" (nao "celular"), "combinar" (nao "agendar" no sentido informal), etc.
- Evita expressoes tipicamente brasileiras (ex: "bacana", "legal" como elogio, "oi", "cara")
- NUNCA uses emojis
- NUNCA uses pontos de exclamacao excessivos (1 maximo)`

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
          err instanceof Anthropic.APIError && err.status === 529
        const isRateLimit =
          err instanceof Anthropic.APIError && err.status === 429
        const shouldRetry = (isOverloaded || isRateLimit) && attempt < MAX_RETRIES

        if (!shouldRetry) throw err

        const delay = BASE_DELAY_MS * Math.pow(2, attempt)
        await new Promise((r) => setTimeout(r, delay))
      }
    }

    throw new Error('Anthropic API indisponivel apos varias tentativas')
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

    // Tentativa 2: remover virgulas a seguir ao ultimo elemento
    try {
      const cleaned = raw.replace(/,(\s*[}\]])/g, '$1')
      return JSON.parse(cleaned) as T
    } catch { /* continuar */ }

    // Tentativa 3: andar char a char a tracar string/escape/depth, encontrar
    // ultima posicao APOS um '}' que esta dentro de array (= fim de item completo).
    // Cortar ai e fechar arrays/objectos abertos. Funciona quando a resposta e
    // truncada a meio de um item de array por max_tokens.
    try {
      let inString = false
      let escape = false
      let arrayDepth = 0
      let lastSafeCut = -1
      for (let i = 0; i < raw.length; i++) {
        const c = raw[i]
        if (escape) { escape = false; continue }
        if (c === '\\' && inString) { escape = true; continue }
        if (c === '"') { inString = !inString; continue }
        if (inString) continue
        if (c === '[') arrayDepth++
        else if (c === ']') arrayDepth--
        else if (c === '}' && arrayDepth > 0) lastSafeCut = i + 1
      }
      if (lastSafeCut > start) {
        const partial = raw.slice(0, lastSafeCut)
        // Recontar o que esta aberto a partir de partial, ignorando dentro de strings
        let openArrays = 0
        let openObjects = 0
        let inS = false
        let esc = false
        for (let i = 0; i < partial.length; i++) {
          const c = partial[i]
          if (esc) { esc = false; continue }
          if (c === '\\' && inS) { esc = true; continue }
          if (c === '"') { inS = !inS; continue }
          if (inS) continue
          if (c === '{') openObjects++
          else if (c === '}') openObjects--
          else if (c === '[') openArrays++
          else if (c === ']') openArrays--
        }
        const closing = ']'.repeat(Math.max(0, openArrays)) + '}'.repeat(Math.max(0, openObjects))
        return JSON.parse(partial + closing) as T
      }
    } catch { /* continuar */ }

    throw new Error(`JSON invalido na resposta do agente. Posicao aprox. ${raw.length} chars. Inicio: ${raw.slice(0, 100)}`)
  }
}
