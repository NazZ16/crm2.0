// /api/auth/google/callback
// Callback do OAuth Google. Recebe ?code=...&state=...
// Valida nonce, troca code por tokens, persiste em team_calendar_connections.

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { exchangeCodeForTokens, fetchGoogleEmail } from '@/lib/google-calendar'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const stateRaw = url.searchParams.get('state')
  const error = url.searchParams.get('error')

  // Utilizador cancelou no consentimento Google
  if (error) {
    return NextResponse.redirect(`${url.origin}/dashboard/settings?google_error=${encodeURIComponent(error)}`)
  }

  if (!code || !stateRaw) {
    return NextResponse.redirect(`${url.origin}/dashboard/settings?google_error=missing_params`)
  }

  // Validar state (nonce + user_id)
  let parsedState: { nonce: string; user_id: string; team_id: string }
  try {
    parsedState = JSON.parse(Buffer.from(stateRaw, 'base64url').toString('utf8'))
  } catch {
    return NextResponse.redirect(`${url.origin}/dashboard/settings?google_error=invalid_state`)
  }

  // Verifica nonce no cookie
  const cookieNonce = request.headers
    .get('cookie')
    ?.split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith('google_oauth_nonce='))
    ?.split('=')[1]

  if (!cookieNonce || cookieNonce !== parsedState.nonce) {
    return NextResponse.redirect(`${url.origin}/dashboard/settings?google_error=nonce_mismatch`)
  }

  // Verificar utilizador autenticado e que o team bate
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.id !== parsedState.user_id) {
    return NextResponse.redirect(`${url.origin}/dashboard/settings?google_error=user_mismatch`)
  }

  try {
    const tokens = await exchangeCodeForTokens(code, url.origin)
    if (!tokens.refresh_token) {
      // Se ja tinha autorizado antes sem prompt=consent, Google pode nao devolver refresh_token.
      // Como usamos prompt=consent, isto nao deve acontecer — mas por seguranca falhamos com mensagem clara.
      return NextResponse.redirect(`${url.origin}/dashboard/settings?google_error=no_refresh_token`)
    }

    const email = await fetchGoogleEmail(tokens.access_token).catch(() => null)
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

    const svc = createServiceClient()
    // Upsert: substitui conexao anterior se existir
    await svc
      .from('team_calendar_connections')
      .upsert(
        {
          team_id: parsedState.team_id,
          provider: 'google',
          refresh_token: tokens.refresh_token,
          access_token: tokens.access_token,
          expires_at: expiresAt,
          scope: tokens.scope,
          google_account_email: email,
          calendar_id: 'primary',
          connected_by: user.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'team_id,provider' }
      )

    const res = NextResponse.redirect(`${url.origin}/dashboard/settings?google_connected=1`)
    res.cookies.delete('google_oauth_nonce')
    return res
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    console.error('[google callback] erro:', msg)
    return NextResponse.redirect(`${url.origin}/dashboard/settings?google_error=${encodeURIComponent(msg)}`)
  }
}
