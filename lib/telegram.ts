// lib/telegram.ts
// Helper para enviar mensagens via Telegram Bot API.
// Usado pelo webhook (resposta inline) e pelo cron de briefing diario.

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? ''

export interface TelegramSendResult {
  ok: boolean
  status: number
  error?: string
}

/**
 * Envia uma mensagem de texto a um chat.
 * Usa parse_mode HTML por defeito (suporta <b>, <i>, <code>, <a>, e \n para newline).
 *
 * Limites Telegram:
 *   - Mensagem tem max 4096 chars; se exceder, partimos em mensagens consecutivas
 *   - Rate limit: ~30 msgs/sec por bot, ~1 msg/sec por chat
 */
export async function sendTelegramMessage(
  chatId: number | string,
  text: string,
  opts?: { parseMode?: 'HTML' | 'MarkdownV2' | 'Markdown'; disableLinkPreview?: boolean }
): Promise<TelegramSendResult> {
  if (!BOT_TOKEN) {
    return { ok: false, status: 0, error: 'TELEGRAM_BOT_TOKEN nao configurado' }
  }

  const parseMode = opts?.parseMode ?? 'HTML'
  const disableLinkPreview = opts?.disableLinkPreview ?? true

  // Telegram tem limite de 4096 chars. Se ultrapassar, partimos em chunks.
  const MAX = 4000 // margem de seguranca
  const chunks: string[] = []
  if (text.length <= MAX) {
    chunks.push(text)
  } else {
    let remaining = text
    while (remaining.length > 0) {
      if (remaining.length <= MAX) {
        chunks.push(remaining)
        break
      }
      // Tenta cortar em \n para nao partir HTML tags a meio
      const cutAt = remaining.lastIndexOf('\n', MAX)
      const cut = cutAt > MAX / 2 ? cutAt : MAX
      chunks.push(remaining.slice(0, cut))
      remaining = remaining.slice(cut).trimStart()
    }
  }

  let lastResult: TelegramSendResult = { ok: true, status: 200 }
  for (const chunk of chunks) {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: chunk,
        parse_mode: parseMode,
        disable_web_page_preview: disableLinkPreview,
      }),
    })
    if (!res.ok) {
      const errText = await res.text().catch(() => 'unknown')
      lastResult = { ok: false, status: res.status, error: errText }
      console.warn(`[telegram] sendMessage falhou ${res.status}: ${errText}`)
      break
    }
  }
  return lastResult
}

/**
 * Lista de chat IDs autorizados (TELEGRAM_ALLOWED_CHAT_IDS, csv).
 * Usado para enviar broadcasts (e.g. briefing diario).
 */
export function getAllowedChatIds(): number[] {
  return (process.env.TELEGRAM_ALLOWED_CHAT_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number.parseInt(s, 10))
    .filter((n) => Number.isFinite(n))
}

/**
 * Escapa texto para uso seguro em parse_mode HTML do Telegram.
 * Apenas <, >, & precisam de ser escapados.
 */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
