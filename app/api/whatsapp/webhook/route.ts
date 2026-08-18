/**
 * /api/whatsapp/webhook — recebe mensagens do WhatsApp Cloud API (Meta) e atualiza o CRM.
 *
 * Leitura apenas: nunca envia mensagens pela API. O envio continua a ser feito
 * manualmente pelo telemóvel (modo coexistência da Meta).
 *
 * GET  — handshake de verificação exigido pela Meta ao configurar o webhook na App.
 * POST — recebe as mensagens: valida a assinatura, resolve/cria a lead por telefone
 *        (mesmo padrão de dedup do lib/call-pipeline.ts), regista em `interactions`
 *        e cria uma `notification`.
 */
import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { createServiceClient } from '@/lib/supabase/server'
import { normalizePhone } from '@/lib/phone'
import { resolveLeadAndLogMessage } from '@/lib/whatsapp-ingest'

const APP_SECRET = process.env.WHATSAPP_APP_SECRET ?? ''
const VERIFY_TOKEN = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? ''
const DEFAULT_TEAM_ID = process.env.WHATSAPP_DEFAULT_TEAM_ID ?? ''
const DEFAULT_USER_ID = process.env.WHATSAPP_DEFAULT_USER_ID ?? ''

interface WhatsAppMessage {
  from: string
  id: string
  timestamp: string
  type: string
  text?: { body: string }
}

interface WhatsAppContact {
  profile?: { name?: string }
  wa_id: string
}

interface WhatsAppValue {
  messaging_product: string
  contacts?: WhatsAppContact[]
  messages?: WhatsAppMessage[]
  statuses?: unknown[]
}

interface WhatsAppWebhookPayload {
  object?: string
  entry?: Array<{
    id: string
    changes: Array<{ value: WhatsAppValue; field: string }>
  }>
}

function verifySignature(rawBody: string, signatureHeader: string | null): boolean {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false
  const expected = crypto.createHmac('sha256', APP_SECRET).update(rawBody).digest('hex')
  const provided = signatureHeader.slice('sha256='.length)
  const expectedBuf = Buffer.from(expected, 'hex')
  const providedBuf = Buffer.from(provided, 'hex')
  if (expectedBuf.length !== providedBuf.length) return false
  return crypto.timingSafeEqual(expectedBuf, providedBuf)
}

function messageText(message: WhatsAppMessage): string {
  if (message.type === 'text' && message.text?.body) return message.text.body
  return `[mensagem: ${message.type}]`
}

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url)
  const mode = searchParams.get('hub.mode')
  const token = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  if (!VERIFY_TOKEN) {
    return NextResponse.json({ error: 'Webhook não configurado' }, { status: 503 })
  }
  if (mode === 'subscribe' && token === VERIFY_TOKEN && challenge) {
    return new NextResponse(challenge, { status: 200 })
  }
  return NextResponse.json({ error: 'Verificação falhou' }, { status: 403 })
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!APP_SECRET) {
    return NextResponse.json({ error: 'Webhook não configurado' }, { status: 503 })
  }

  const rawBody = await request.text()
  const signature = request.headers.get('x-hub-signature-256')
  if (!verifySignature(rawBody, signature)) {
    return NextResponse.json({ error: 'Assinatura inválida' }, { status: 401 })
  }

  if (!DEFAULT_TEAM_ID || !DEFAULT_USER_ID) {
    return NextResponse.json(
      { error: 'WHATSAPP_DEFAULT_TEAM_ID ou WHATSAPP_DEFAULT_USER_ID em falta' },
      { status: 503 }
    )
  }

  let payload: WhatsAppWebhookPayload
  try {
    payload = JSON.parse(rawBody) as WhatsAppWebhookPayload
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const supabase = createServiceClient()

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const { messages, contacts } = change.value
      if (!messages || messages.length === 0) continue

      for (const message of messages) {
        try {
          await processMessage(supabase, message, contacts)
        } catch (err) {
          console.error('[whatsapp-webhook] falhou a processar mensagem', {
            messageId: message.id,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }
    }
  }

  return NextResponse.json({ received: true })
}

async function processMessage(
  supabase: ReturnType<typeof createServiceClient>,
  message: WhatsAppMessage,
  contacts: WhatsAppContact[] | undefined
): Promise<void> {
  const phone = normalizePhone(message.from)
  if (!phone) return

  const text = messageText(message)
  const occurredAt = new Date(Number(message.timestamp) * 1000).toISOString()
  const profileName = contacts?.find((c) => c.wa_id === message.from)?.profile?.name?.trim()

  await resolveLeadAndLogMessage(supabase, {
    teamId: DEFAULT_TEAM_ID,
    userId: DEFAULT_USER_ID,
    phone,
    text,
    profileName,
    occurredAt,
  })
}
