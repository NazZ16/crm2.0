import crypto from 'crypto'

/**
 * Verifica a assinatura HMAC-SHA256 de um webhook N8N.
 * N8N deve enviar o header X-N8N-Signature com o valor hmac-sha256=<hash>
 */
export function verifyN8NWebhook(body: string, signatureHeader: string): boolean {
  if (!process.env.N8N_WEBHOOK_SECRET) {
    console.error('[N8N] N8N_WEBHOOK_SECRET não configurado')
    return false
  }

  const expected = 'hmac-sha256=' + crypto
    .createHmac('sha256', process.env.N8N_WEBHOOK_SECRET)
    .update(body)
    .digest('hex')

  try {
    return crypto.timingSafeEqual(
      Buffer.from(signatureHeader),
      Buffer.from(expected)
    )
  } catch {
    return false
  }
}

/**
 * Chama um workflow N8N via webhook URL
 */
export async function triggerN8NWorkflow(
  webhookPath: string,
  payload: Record<string, unknown>
): Promise<{ ok: boolean; error?: string }> {
  const baseUrl = process.env.N8N_BASE_URL
  if (!baseUrl) {
    return { ok: false, error: 'N8N_BASE_URL não configurado' }
  }

  try {
    const url = `${baseUrl}/webhook/${webhookPath}`
    const body = JSON.stringify(payload)
    const signature = 'hmac-sha256=' + crypto
      .createHmac('sha256', process.env.N8N_WEBHOOK_SECRET!)
      .update(body)
      .digest('hex')

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-N8N-Signature': signature,
      },
      body,
    })

    if (!res.ok) {
      return { ok: false, error: `N8N respondeu com status ${res.status}` }
    }

    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}
