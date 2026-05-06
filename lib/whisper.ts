import OpenAI from 'openai'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  // Timeout generoso (10min) para uploads de chamadas longas.
  // Vercel maxDuration cobre o resto.
  timeout: 10 * 60 * 1000,
})

export interface WhisperResult {
  text: string
  duration_s: number | null
  model: string
}

// Limite duro da API OpenAI para qualquer modelo de transcricao.
// Se o ficheiro exceder isto, falhamos rapidamente com erro claro.
const OPENAI_AUDIO_FILE_LIMIT_BYTES = 25 * 1024 * 1024

// Prompt de contexto melhora drasticamente a qualidade no fim do audio
// (Whisper usa-o como hint de dominio/lingua/vocabulario).
const PORTUGUESE_REAL_ESTATE_PROMPT =
  'Conversa em portugues europeu entre consultor imobiliario e cliente sobre venda, compra ou arrendamento de imoveis. Vocabulario tipico: imovel, T0, T1, T2, T3, apartamento, moradia, garagem, varanda, escritura, sinal, financiamento, prestacao, comissao, RE/MAX, Porto, Paranhos, Gaia.'

function mimeTypeFromFilename(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase()
  const map: Record<string, string> = {
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    oga: 'audio/ogg',
    opus: 'audio/ogg',
    webm: 'audio/webm',
    flac: 'audio/flac',
    mp4: 'audio/mp4',
  }
  return map[ext ?? ''] ?? 'audio/mpeg'
}

/**
 * Transcreve um buffer de audio usando a API OpenAI.
 *
 * Estrategia:
 *   1. Tenta gpt-4o-mini-transcribe (mais novo, melhor em audio longo, sem
 *      problema documentado de truncar o fim que afecta o whisper-1).
 *   2. Fallback para whisper-1 (com verbose_json p/ ter duration_s) caso
 *      o modelo novo falhe.
 *
 * O prompt fornece contexto de imobiliario PT para reduzir ainda mais
 * a probabilidade de o modelo "saltar" o fim por falta de contexto semantico.
 */
export async function transcribeAudio(
  audioBuffer: Buffer,
  filename: string
): Promise<WhisperResult> {
  const fileSize = audioBuffer.byteLength
  console.log(`[whisper] start file=${filename} size=${(fileSize / 1024 / 1024).toFixed(2)}MB`)

  if (fileSize > OPENAI_AUDIO_FILE_LIMIT_BYTES) {
    throw new Error(
      `Ficheiro de audio (${(fileSize / 1024 / 1024).toFixed(1)} MB) excede o limite de ${OPENAI_AUDIO_FILE_LIMIT_BYTES / 1024 / 1024} MB da OpenAI. Reduz a qualidade no Plaud (e.g. 64 kbps) ou divide a chamada antes de fazer upload.`
    )
  }

  const file = new File([new Uint8Array(audioBuffer)], filename, {
    type: mimeTypeFromFilename(filename),
  })

  // Tentativa 1: gpt-4o-mini-transcribe (recomendado para audio longo).
  try {
    const t0 = Date.now()
    const transcription = await openai.audio.transcriptions.create({
      file,
      model: 'gpt-4o-mini-transcribe',
      language: 'pt',
      prompt: PORTUGUESE_REAL_ESTATE_PROMPT,
      response_format: 'json',
    })
    const text = (transcription as { text?: string }).text ?? ''
    const elapsedMs = Date.now() - t0
    console.log(
      `[whisper] gpt-4o-mini OK chars=${text.length} elapsed=${elapsedMs}ms ratio=${
        text.length / Math.max(1, fileSize / 1024)
      }chars/KB`
    )
    return {
      text,
      duration_s: null, // gpt-4o-mini-transcribe nao devolve duration; usar whisper-1 fallback se for critico
      model: 'gpt-4o-mini-transcribe',
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[whisper] gpt-4o-mini-transcribe falhou (${msg}), fallback para whisper-1`)
  }

  // Fallback: whisper-1 com verbose_json.
  // Recriamos o File porque alguns SDKs consomem o stream na primeira tentativa.
  const fileRetry = new File([new Uint8Array(audioBuffer)], filename, {
    type: mimeTypeFromFilename(filename),
  })

  const t0 = Date.now()
  const transcription = await openai.audio.transcriptions.create({
    file: fileRetry,
    model: 'whisper-1',
    language: 'pt',
    prompt: PORTUGUESE_REAL_ESTATE_PROMPT,
    response_format: 'verbose_json',
  })
  const text = (transcription as { text?: string }).text ?? ''
  const duration = (transcription as { duration?: number }).duration ?? null
  const elapsedMs = Date.now() - t0
  console.log(
    `[whisper] whisper-1 OK chars=${text.length} duration=${duration ?? '?'}s elapsed=${elapsedMs}ms`
  )

  return {
    text,
    duration_s: duration,
    model: 'whisper-1',
  }
}
