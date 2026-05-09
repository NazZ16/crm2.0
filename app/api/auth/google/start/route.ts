// /api/auth/google/start
// Redireciona para o ecra de consentimento do Google. Guarda um state com o user_id
// para validar no callback (proteccao CSRF basica).

import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { buildAuthUrl } from '@/lib/google-calendar'
import crypto from 'node:crypto'

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })

  const { data: member } = await supabase
    .from('team_members')
    .select('team_id, role')
    .eq('user_id', user.id)
    .single()
  if (!member || member.role === 'viewer') {
    return NextResponse.json({ error: 'Sem permissao' }, { status: 403 })
  }

  const url = new URL(request.url)
  const origin = url.origin

  // State e um nonce + user_id assinado simples — o callback verifica.
  const nonce = crypto.randomBytes(16).toString('hex')
  const state = Buffer.from(JSON.stringify({ nonce, user_id: user.id, team_id: member.team_id })).toString('base64url')

  const authUrl = buildAuthUrl(origin, state)
  const res = NextResponse.redirect(authUrl)
  // Cookie HttpOnly com o nonce para validar no callback (defesa contra CSRF)
  res.cookies.set('google_oauth_nonce', nonce, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 600, // 10 minutos
    path: '/',
  })
  return res
}
