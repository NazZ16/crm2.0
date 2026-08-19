/**
 * /api/ingest — endpoint consumido pelo Elsio Hub (router do Telegram).
 *
 * Contrato (shape IngestPayload definido em elsio-hub/src/lib/crmClient.ts):
 *   {
 *     chatId: number,
 *     contentType: 'voice' | 'audio' | 'document' | 'photo' | 'video' | 'text',
 *     text?: string,
 *     fileUrl?: string,
 *     fileName?: string,
 *     mimeType?: string,
 *     metadata: {
 *       source: 'telegram-elsio-hub',
 *       telegramUpdateId: number,
 *       classification: { intent, confidence, reasoning },
 *       receivedAt: string,
 *       knownContactName?: string,  // se já sabes quem é (ex: app de gravação de chamadas),
 *       knownPhone?: string         // tem prioridade sobre a extração por IA da transcrição
 *     }
 *   }
 *
 * Auth: header `x-ingest-secret` == env CRM_INGEST_SECRET.
 *
 * Comportamento:
 *   - So aceita payload audio (voice, audio, ou document com MIME audio/*).
 *   - Descarrega do fileUrl, guarda em Supabase Storage, cria linha call_uploads,
 *     arranca runCallPipeline em after() e responde 202 rapido.
 *
 * Este endpoint corre em paralelo ao webhook antigo em /api/telegram/webhook
 * ate a Fase 6 fazer o cutover. NAO alterar o webhook antigo aqui.
 */
import { NextResponse, after } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { runCallPipeline } from '@/lib/call-pipeline'

export const maxDuration = 300

const INGEST_SECRET = process.env.CRM_INGEST_SECRET ?? ''
const DEFAULT_TEAM_ID = process.env.TELEGRAM_DEFAULT_TEAM_ID ?? ''
const DEFAULT_USER_ID = process.env.TELEGRAM_DEFAULT_USER_ID ?? ''
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? ''
const HUB_NOTIFY_URL = process.env.HUB_NOTIFY_URL ?? ''
const HUB_NOTIFY_SECRET = process.env.HUB_NOTIFY_SECRET ?? ''

/**
 * Avisa o Hub quando o pipeline termina. Falha silenciosa — o CRM nao deve
 * crashar porque o Hub esta offline. O utilizador ficara sem notificacao
 * mas o processamento em si concluiu.
 */
async function notifyHub(
  chatId: number | undefined,
  text: string,
  source: 'crm' = 'crm',
  uploadId?: string,
): Promise<void> {
  if (!HUB_NOTIFY_URL || !HUB_NOTIFY_SECRET) return
  if (typeof chatId !== 'number' || !Number.isFinite(chatId)) return
  try {
    await fetch(HUB_NOTIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-notify-secret': HUB_NOTIFY_SECRET },
      body: JSON.stringify({ chatId, text, source, uploadId }),
    })
  } catch (e) {
    console.error('[ingest] notifyHub falhou', {
      error: e instanceof Error ? e.message : String(e),
      chatId,
      uploadId,
    })
  }
}

const MAX_FILE_SIZE = 50 * 1024 * 1024

type IngestMetadata = {
  source?: string
  telegramUpdateId?: number
  classification?: { intent?: string; confidence?: number; reasoning?: string }
  receivedAt?: string
  knownContactName?: string
  knownPhone?: string
}

type IngestPayload = {
  chatId?: number
  contentType?: string
  text?: string
  fileUrl?: string
  fileName?: string
  mimeType?: string
  metadata?: IngestMetadata
}

function sanitizeFilename(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 200)
}

function resolveAudioFilename(payload: IngestPayload, isVoice: boolean): string {
  if (payload.fileName) return sanitizeFilename(payload.fileName)
  const ext = isVoice ? 'ogg' : 'mp3'
  return 'hub_audio_' + Date.now() + '.' + ext
}

function resolveMimeType(payload: IngestPayload, isVoice: boolean): string {
  if (payload.mimeType && payload.mimeType.length > 0) return payload.mimeType
  return isVoice ? 'audio/ogg' : 'audio/mpeg'
}

function err(status: number, code: string, message?: string): NextResponse {
  return NextResponse.json({ ok: false, code, message }, { status })
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    ok: true,
    service: 'crm2.0',
    endpoint: 'ingest',
    accepts: ['voice', 'audio', 'document(audio/*)'],
  })
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!INGEST_SECRET) {
    return err(503, 'not_configured', 'CRM_INGEST_SECRET em falta')
  }
  const secretHeader = request.headers.get('x-ingest-secret') ?? ''
  if (secretHeader !== INGEST_SECRET) {
    return err(401, 'unauthorized')
  }

  if (!DEFAULT_TEAM_ID || !DEFAULT_USER_ID) {
    return err(503, 'server_misconfigured', 'TELEGRAM_DEFAULT_TEAM_ID ou TELEGRAM_DEFAULT_USER_ID em falta')
  }

  let payload: IngestPayload
  try {
    payload = (await request.json()) as IngestPayload
  } catch {
    return err(400, 'invalid_json')
  }

  const contentType = payload.contentType
  const fileUrl = payload.fileUrl
  const isVoice = contentType === 'voice'
  const isAudio = contentType === 'audio' || isVoice
  const isAudioDocument =
    contentType === 'document' &&
    typeof payload.mimeType === 'string' &&
    payload.mimeType.startsWith('audio/')

  if (!isAudio && !isAudioDocument) {
    return err(415, 'unsupported_content', 'contentType ' + contentType + ' nao e aceite em /api/ingest (so audio)')
  }
  if (!fileUrl) {
    return err(400, 'missing_file_url', 'payload sem fileUrl — Hub deve resolver Telegram getFile antes de despachar')
  }

  const supabase = createServiceClient()
  let audioBuffer: Buffer
  try {
    const fileRes = await fetch(fileUrl)
    if (!fileRes.ok) {
      return err(502, 'file_download_failed', 'Upstream devolveu ' + fileRes.status)
    }
    const arr = await fileRes.arrayBuffer()
    audioBuffer = Buffer.from(arr)
    if (audioBuffer.byteLength > MAX_FILE_SIZE) {
      return err(413, 'file_too_large', 'Ficheiro ' + audioBuffer.byteLength + 'B excede ' + MAX_FILE_SIZE + 'B')
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return err(502, 'file_download_error', msg)
  }

  const filename = resolveAudioFilename(payload, isVoice)
  const mimeType = resolveMimeType(payload, isVoice)
  const storagePath = DEFAULT_TEAM_ID + '/calls/' + Date.now() + '-' + filename

  await supabase.storage
    .createBucket('call-audio', { public: false, fileSizeLimit: MAX_FILE_SIZE })
    .catch(() => {})

  const { error: storageError } = await supabase.storage
    .from('call-audio')
    .upload(storagePath, audioBuffer, { contentType: mimeType, upsert: false })

  if (storageError) {
    return err(500, 'storage_upload_failed', storageError.message)
  }

  const { data: uploadRow, error: insertError } = await supabase
    .from('call_uploads')
    .insert({
      team_id: DEFAULT_TEAM_ID,
      storage_path: storagePath,
      status: 'transcribing',
    })
    .select('id')
    .single()

  if (insertError || !uploadRow) {
    void supabase.storage.from('call-audio').remove([storagePath])
    return err(500, 'db_insert_failed', insertError?.message ?? 'insert sem linha devolvida')
  }

  const dashboardUrl = SITE_URL
    ? SITE_URL + '/dashboard/leads/upload-call?id=' + uploadRow.id
    : undefined

  const hubChatId =
    typeof payload.chatId === 'number' && Number.isFinite(payload.chatId)
      ? payload.chatId
      : undefined

  const knownContactName = payload.metadata?.knownContactName?.trim() || undefined
  const knownPhone = payload.metadata?.knownPhone?.trim() || undefined

  after(
    runCallPipeline(
      uploadRow.id,
      DEFAULT_TEAM_ID,
      audioBuffer,
      filename,
      DEFAULT_USER_ID,
      { knownContactName, knownPhone },
    ).then(
      async () => {
        const successText = dashboardUrl
          ? '\u2705 <b>\u00c1udio processado com sucesso!</b>\n\nVer lead e transcri\u00e7\u00e3o:\n' + dashboardUrl
          : '\u2705 <b>\u00c1udio processado com sucesso!</b>'
        await notifyHub(hubChatId, successText, 'crm', uploadRow.id)
      },
      async (pipelineErr: unknown) => {
        const errMsg = pipelineErr instanceof Error ? pipelineErr.message : String(pipelineErr)
        console.error('[ingest] runCallPipeline falhou', { uploadId: uploadRow.id, errMsg })
        await notifyHub(
          hubChatId,
          '\u274c <b>Erro ao processar \u00e1udio no CRM</b>\n\n' + errMsg,
          'crm',
          uploadRow.id,
        )
      },
    ),
  )

  return NextResponse.json(
    {
      ok: true,
      uploadId: uploadRow.id,
      dashboardUrl,
      message: 'Aceite — pipeline de chamada a correr em background',
    },
    { status: 202 },
  )
}
