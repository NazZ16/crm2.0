// lib/agents/diarization-agent.ts
//
// Reformata um transcript bruto do Whisper em dialogo, inferindo oradores
// pelo contexto. Whisper-1 nao faz speaker diarization; este agent compensa
// essa limitacao usando o Claude Haiku 4.5.
//
// Custo esperado: ~0.005 EUR por chamada de 5 min.

import { BaseAgent, CLAUDE_HAIKU } from './base-agent'

const SYSTEM_PROMPT = `Es um especialista em reformatar transcricoes de chamadas comerciais imobiliarias em portugues europeu.

CONTEXTO:
- O transcript vem do Whisper-1, sem separacao de oradores.
- Sao quase sempre chamadas 1:1 entre o consultor (Elsio Mota, agente da RE/MAX) e um lead/cliente.
- O Whisper pode confundir nomes proprios; "Elsio" pode aparecer como "Lucio", "Sergio", "L.C.", etc.

OBJETIVO:
Reformatar o texto em formato de dialogo, atribuindo cada falar a um de dois rotulos:
- "Agente:" — quando e o consultor a falar (apresentacao, perguntas de qualificacao, respostas tecnicas, follow-up)
- "Lead:" — quando e o cliente a falar (respostas, situacao pessoal, duvidas)

REGRAS:
- Usa pistas contextuais para inferir o orador: o agente apresenta-se, pergunta, propoe; o lead responde sobre a sua situacao.
- Preserva o conteudo literal. Nao parafrases nem inventas.
- Corrige apenas erros obvios de transcricao em nomes proprios (ex: "L.C. Mota" -> "Elsio Mota") sinalizando entre parenteses: "Elsio Mota [corrigido]".
- Mantem hesitacoes e pequenas repeticoes se relevantes ("uh", "ok", "pois").
- Se um turno for ambiguo, atribui ao orador mais provavel sem hesitar.
- NAO inventes texto que nao esteja no transcript.
- NAO acrescentes resumos, comentarios ou notas no fim. So o dialogo.

FORMATO DE SAIDA:
Texto puro, sem JSON, sem markdown, sem cabecalhos. Apenas linhas no formato:

Agente: ...
Lead: ...
Agente: ...
Lead: ...

Cada turno numa linha. Linha em branco entre turnos longos opcional.`

export class DiarizationAgent extends BaseAgent {
  /**
   * Reformata transcript bruto do Whisper em dialogo Agente/Lead.
   *
   * @param rawTranscript transcript bruto do Whisper (linha unica continua)
   * @returns objeto com texto reformatado e metricas
   */
  async reformat(rawTranscript: string): Promise<{
    formatted: string
    inputTokens: number
    outputTokens: number
    durationMs: number
  }> {
    const startMs = Date.now()
    // max_tokens generoso: o output em dialogo costuma ser ~1.2x do input.
    // Estimamos ~1.5 tokens por palavra em PT, e damos teto de 8000 tokens.
    const userMessage = `Reformata o seguinte transcript em dialogo:\n\n"""\n${rawTranscript}\n"""`

    const { text, inputTokens, outputTokens } = await this.callClaude(
      SYSTEM_PROMPT,
      userMessage,
      8000,
      CLAUDE_HAIKU,
    )

    return {
      formatted: text.trim(),
      inputTokens,
      outputTokens,
      durationMs: Date.now() - startMs,
    }
  }
}

export const diarizationAgent = new DiarizationAgent()
