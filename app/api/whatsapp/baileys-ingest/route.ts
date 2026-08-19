/**
 * /api/whatsapp/baileys-ingest — recebe mensagens do worker Baileys (whatsapp-worker/,
 * deployado à parte na Railway, ligação não-oficial ao WhatsApp). Mesmo objetivo do
 * /api/whatsapp/webhook (Cloud API da Meta), mas payload mais simples e auth por segredo
 * partilhado em vez de assinatura HMAC — o worker é nosso, não uma origem externa a validar.
 *
 * Leitura apenas: nunca envia mensagens de volta.
 */
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { normalizePhone } from '@/lib/phone'
import { resolveLeadAndLogMessage } from '@/lib/whatsapp-ingest'

const INGEST_SECRET = process.env.WHATSAPP_BAILEYS_INGEST_SECRET ?? ''
const DEFAULT_TEAM_ID = process.env.WHATSAPP_DEFAULT_TEAM_ID ?? ''
const DEFAULT_USER_ID = process.env.WHATSAPP_DEFAULT_USER_ID ?? ''

interface BaileysIngestPayload {
  phone?: string
  text?: string
  profileName?: string
  occurredAt?: string
  fromMe?: boolean
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
  if (!phone || !payload.text) {
    return NextResponse.json({ error: 'phone e text são obrigatórios' }, { status: 400 })
  }

  const occurredAt = payload.occurredAt ?? new Date().toISOString()

  try {
    const supabase = createServiceClient()
    const { leadId } = await resolveLeadAndLogMessage(supabase, {
      teamId: DEFAULT_TEAM_ID,
      userId: DEFAULT_USER_ID,
      phone,
      text: payload.text,
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
