import OpenAI from 'openai'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export interface WhisperResult {
  text: string
  duration_s: number | null
}

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

export async function transcribeAudio(
  audioBuffer: Buffer,
  filename: string
): Promise<WhisperResult> {
  const file = new File([new Uint8Array(audioBuffer)], filename, {
    type: mimeTypeFromFilename(filename),
  })

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
