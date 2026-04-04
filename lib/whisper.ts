import OpenAI from 'openai'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export interface WhisperResult {
  text: string
  duration_s: number | null
}

export async function transcribeAudio(
  audioBuffer: Buffer,
  filename: string
): Promise<WhisperResult> {
  const file = new File([new Uint8Array(audioBuffer)], filename, { type: 'audio/mpeg' })

  const transcription = await openai.audio.transcriptions.create({
    file,
    model: 'whisper-1',
    language: 'pt',
    response_format: 'verbose_json',
  })

  return {
    text: transcription.text,
    duration_s: (transcription as { duration?: number }).duration ?? null,
  }
}
