/**
 * /api/whatsapp/baileys-ingest — recebe mensagens do worker Baileys (whatsapp-worker/,
 * deployado à parte na Railway, ligação não-oficial ao WhatsApp). Mesmo objetivo do
 * /api/whatsapp/webhook (Cloud API da Meta), mas payload mais simples e auth por segredo
 * partilhado em vez de assinatura HMAC — o worker é nosso, não uma origem externa a validar.
 *
 * Leitura apenas: nunca envia mensagens de volta.
 *
 * Mensagens de áudio (voz do WhatsApp) chegam como `audioBase64` em vez de `text` — o worker
 * não transcreve nada, só descarrega o ficheiro; a transcrição acontece aqui com o mesmo
 * pipeline Whisper usado para chamadas (lib/whisper.ts).
 */
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { normalizePhone } from '@/lib/phone'
import { resolveLeadAndLogMessage } from '@/lib/whatsapp-ingest'
import { transcribeAudio } from '@/lib/whisper'

export const maxDuration = 120

const INGEST_SECRET = process.env.WHATSAPP_BAILEYS_INGEST_SECRET ?? ''
const DEFAULT_TEAM_ID = process.env.WHATSAPP_DEFAULT_TEAM_ID ?? ''
const DEFAULT_USER_ID = process.env.WHATSAPP_DEFAULT_USER_ID ?? ''

interface BaileysIngestPayload {
  phone?: string
  text?: string
  audioBase64?: string
  audioMimeType?: string
  profileName?: string
  occurredAt?: string
  fromMe?: boolean
}

function extensionFromMimeType(mimeType: string | undefined): string {
  const type = mimeType ?? ''
  if (type.includes('ogg')) return 'ogg'
  if (type.includes('mp4') || type.includes('m4a')) return 'm4a'
  if (type.includes('mpeg') || type.includes('mp3')) return 'mp3'
  if (type.includes('wav')) return 'wav'
  if (type.includes('webm')) return 'webm'
  return 'ogg' // mimetype típico de voz do WhatsApp: audio/ogg; codecs=opus
}

async function resolveText(payload: BaileysIngestPayload): Promise<string | null> {
  if (payload.text) return payload.text
  if (!payload.audioBase64) return null

  try {
    const audioBuffer = Buffer.from(payload.audioBase64, 'base64')
    const filename = `whatsapp-audio.${extensionFromMimeType(payload.audioMimeType)}`
    const { text } = await transcribeAudio(audioBuffer, filename)
    return `🎤 ${text}`
  } catch (err) {
    console.error('[baileys-ingest] falhou a transcrever áudio', {
      error: err instanceof Error ? err.message : String(err),
    })
    return '[mensagem de áudio — falhou a transcrição]'
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!INGEST_SECRET) {
    return NextResponse.json({ error: 'Endpoint não configurado' }, { status: 503 })
  }

  const secretHeader = request.headers.get('x-ingest-secret') ?? ''
  if (secretHeader !== INGEST_SECRET) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  if (!DEFAULT_TEAM_ID || !DEFAULT_USER_ID) {
    return NextResponse.json(
      { error: 'WHATSAPP_DEFAULT_TEAM_ID ou WHATSAPP_DEFAULT_USER_ID em falta' },
      { status: 503 }
    )
  }

  let payload: BaileysIngestPayload
  try {
    payload = (await request.json()) as BaileysIngestPayload
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const phone = normalizePhone(payload.phone)
  if (!phone || (!payload.text && !payload.audioBase64)) {
    return NextResponse.json({ error: 'phone e (text ou audioBase64) são obrigatórios' }, { status: 400 })
  }

  const text = await resolveText(payload)
  if (!text) {
    return NextResponse.json({ error: 'Falhou a resolver o conteúdo da mensagem' }, { status: 400 })
  }

  const occurredAt = payload.occurredAt ?? new Date().toISOString()

  try {
    const supabase = createServiceClient()
    const { leadId } = await resolveLeadAndLogMessage(supabase, {
      teamId: DEFAULT_TEAM_ID,
      userId: DEFAULT_USER_ID,
      phone,
      text,
      profileName: payload.profileName,
      occurredAt,
      fromMe: payload.fromMe === true,
    })
    return NextResponse.json({ received: true, leadId })
  } catch (err) {
    console.error('[baileys-ingest] falhou a processar mensagem', {
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: 'Erro ao processar mensagem' }, { status: 500 })
  }
}
