import { NextResponse, after } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { runCallPipeline } from '@/lib/call-pipeline'

export const maxDuration = 120

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? ''
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET ?? ''
const ALLOWED_CHAT_IDS = (process.env.TELEGRAM_ALLOWED_CHAT_IDS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const DEFAULT_TEAM_ID = process.env.TELEGRAM_DEFAULT_TEAM_ID ?? ''
const DEFAULT_USER_ID = process.env.TELEGRAM_DEFAULT_USER_ID ?? ''

const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB

interface TelegramFileInfo {
  file_id: string
  file_name?: string
  mime_type?: string
  file_size?: number
}

interface TelegramUpdate {
  update_id: number
  message?: {
    message_id: number
    from?: { id: number; first_name?: string; username?: string }
    chat: { id: number }
    text?: string
    voice?: TelegramFileInfo
    audio?: TelegramFileInfo
    document?: TelegramFileInfo
  }
}

async function sendMessage(chatId: number, text: string): Promise<void> {
  if (!BOT_TOKEN) return
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  })
}

async function getFileDownloadUrl(fileId: string): Promise<string> {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`)
  const data = (await res.json()) as { ok: boolean; result?: { file_path: string }; description?: string }
  if (!data.ok || !data.result) {
    throw new Error(`Telegram getFile falhou: ${data.description ?? 'erro desconhecido'}`)
  }
  return `https://api.telegram.org/file/bot${BOT_TOKEN}/${data.result.file_path}`
}

function sanitizeFilename(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 200)
}

function resolveAudioFilename(fileInfo: TelegramFileInfo, isVoice: boolean): string {
  if (fileInfo.file_name) return sanitizeFilename(fileInfo.file_name)
  const ext = isVoice ? 'ogg' : 'mp3'
  return `telegram_audio_${Date.now()}.${ext}`
}

function resolveMimeType(fileInfo: TelegramFileInfo, isVoice: boolean): string {
  if (fileInfo.mime_type) return fileInfo.mime_type
  return isVoice ? 'audio/ogg' : 'audio/mpeg'
}

export async function POST(request: Request): Promise<NextResponse> {
  // 1. Verify Telegram webhook secret
  if (!WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Bot não configurado' }, { status: 503 })
  }
  const secretHeader = request.headers.get('x-telegram-bot-api-secret-token') ?? ''
  if (secretHeader !== WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  let update: TelegramUpdate
  try {
    update = (await request.json()) as TelegramUpdate
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const message = update.message
  if (!message) return NextResponse.json({ ok: true })

  const chatId = message.chat.id
  const chatIdStr = String(chatId)

  // 2. Check allowed chat IDs
  if (ALLOWED_CHAT_IDS.length > 0 && !ALLOWED_CHAT_IDS.includes(chatIdStr)) {
    await sendMessage(chatId, '⛔ Não tens acesso a este bot.')
    return NextResponse.json({ ok: true })
  }

  // 3. Validate configuration
  if (!DEFAULT_TEAM_ID || !DEFAULT_USER_ID) {
    await sendMessage(chatId, '⚠️ Bot mal configurado: TELEGRAM_DEFAULT_TEAM_ID ou TELEGRAM_DEFAULT_USER_ID em falta.')
    return NextResponse.json({ ok: true })
  }

  // 4. Handle /start command
  if (message.text?.startsWith('/start')) {
    await sendMessage(
      chatId,
      `👋 Olá! Sou o assistente do CRM.\n\n` +
        `Envia-me um áudio ou mensagem de voz para processar automaticamente:\n\n` +
        `1️⃣ Transcrição com Whisper (PT)\n` +
        `2️⃣ Extração de dados da lead\n` +
        `3️⃣ Feedback do coach IA\n\n` +
        `<b>Formatos suportados:</b> MP3, M4A, WAV, OGG\n` +
        `<b>Tamanho máximo:</b> 50MB\n\n` +
        `O teu Chat ID é: <code>${chatId}</code>`
    )
    return NextResponse.json({ ok: true })
  }

  // 5. Detect audio: voice message, audio file, or document (audio)
  const isVoice = Boolean(message.voice)
  const fileInfo = message.voice ?? message.audio ?? message.document

  if (!fileInfo) {
    await sendMessage(chatId, '⚠️ Envia um ficheiro de áudio (MP3, M4A, WAV) ou uma mensagem de voz.')
    return NextResponse.json({ ok: true })
  }

  // 6. Document must be audio MIME
  if (message.document && fileInfo.mime_type && !fileInfo.mime_type.startsWith('audio/')) {
    await sendMessage(chatId, '⚠️ Envia apenas ficheiros de áudio (MP3, M4A, WAV, OGG).')
    return NextResponse.json({ ok: true })
  }

  // 7. File size check
  if (fileInfo.file_size && fileInfo.file_size > MAX_FILE_SIZE) {
    await sendMessage(chatId, '❌ Ficheiro demasiado grande. Máximo 50MB.')
    return NextResponse.json({ ok: true })
  }

  await sendMessage(chatId, '⏳ A processar o áudio... Aguarda um momento.')

  // 8. Manter a função Vercel viva após a resposta com after()
  after(processAudio(chatId, fileInfo, isVoice))

  return NextResponse.json({ ok: true })
}

async function processAudio(
  chatId: number,
  fileInfo: TelegramFileInfo,
  isVoice: boolean
): Promise<void> {
  const supabase = createServiceClient()

  // 8. Download file from Telegram (synchronous — before returning to Telegram)
  let audioBuffer: Buffer
  let filename: string
  let mimeType: string
  let storagePath: string

  try {
    const fileUrl = await getFileDownloadUrl(fileInfo.file_id)
    const fileRes = await fetch(fileUrl)
    if (!fileRes.ok) throw new Error('Falha ao descarregar ficheiro do Telegram')

    const arrayBuffer = await fileRes.arrayBuffer()
    audioBuffer = Buffer.from(arrayBuffer)
    filename = resolveAudioFilename(fileInfo, isVoice)
    mimeType = resolveMimeType(fileInfo, isVoice)
    storagePath = `${DEFAULT_TEAM_ID}/calls/${Date.now()}-${filename}`
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await sendMessage(chatId, `❌ Erro ao descarregar áudio: ${msg}`)
    return NextResponse.json({ ok: true })
  }

  // 9. Upload to Supabase Storage (synchronous — before returning)
  const { error: storageError } = await supabase.storage
    .from('call-audio')
    .upload(storagePath, audioBuffer, { contentType: mimeType, upsert: false })

  if (storageError) {
    await sendMessage(chatId, `❌ Erro ao guardar ficheiro: ${storageError.message}`)
    return NextResponse.json({ ok: true })
  }

  // 10. Create call_uploads record (synchronous — before returning)
  const { data: uploadRow, error: insertError } = await supabase
    .from('call_uploads')
    .insert({ team_id: DEFAULT_TEAM_ID, storage_path: storagePath, status: 'transcribing' })
    .select('id')
    .single()

  if (insertError || !uploadRow) {
    void supabase.storage.from('call-audio').remove([storagePath])
    await sendMessage(chatId, `❌ Erro ao criar registo: ${insertError?.message ?? 'desconhecido'}`)
    return NextResponse.json({ ok: true })
  }

  await sendMessage(chatId, '⏳ Áudio recebido! A transcrever e analisar...')

  // 11. Fire-and-forget pipeline (transcrição + IA) — igual ao /api/calls/upload
  const uploadId = uploadRow.id
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? ''

  void runCallPipeline(uploadId, DEFAULT_TEAM_ID, audioBuffer, filename, DEFAULT_USER_ID).then(() =>
    sendMessage(
      chatId,
      `✅ <b>Processado com sucesso!</b>\n\nVer lead:\n${siteUrl}/dashboard/leads/upload-call?id=${uploadId}`
    )
  ).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err)
    return sendMessage(chatId, `❌ Erro na transcrição/análise: ${msg}`)
  })

  return NextResponse.json({ ok: true })
}
