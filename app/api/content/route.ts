import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { isHubAuthorized, resolveTeamId } from '@/lib/hub-auth'

export const dynamic = 'force-dynamic'

const createContentSchema = z.object({
  title: z.string().min(1).max(200),
  platform: z.enum(['linkedin', 'instagram', 'tiktok', 'youtube', 'blog', 'other']).default('other'),
  idea_text: z.string().max(4000).optional(),
  source: z.enum(['manual', 'hub_telegram']).default('manual'),
})

// GET /api/content?status=idea — usado pela UI (sessao normal)
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: member } = await supabase
    .from('team_members')
    .select('team_id')
    .eq('user_id', user.id)
    .single()

  if (!member) return NextResponse.json({ error: 'Equipa não encontrada' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')

  let query = supabase
    .from('content_pieces')
    .select('*')
    .eq('team_id', member.team_id)
    .order('scheduled_at', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })

  if (status) query = query.eq('status', status)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data ?? [])
}

// POST /api/content — cria uma peca (estado inicial sempre 'idea').
// Aceita sessao normal (UI, botao "Nova ideia") OU x-hub-secret (Elsio Hub,
// tool capture_content_idea) — mesmo padrao dual usado noutros endpoints.
export async function POST(request: Request) {
  const body = await request.json()
  const parsed = createContentSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Dados inválidos', details: parsed.error.flatten() }, { status: 400 })
  }

  const hasHubSecret = request.headers.get('x-hub-secret') !== null

  let teamId: string
  if (hasHubSecret) {
    if (!isHubAuthorized(request)) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
    }
    const resolved = resolveTeamId(request)
    if (!resolved) return NextResponse.json({ error: 'team_id em falta' }, { status: 400 })
    teamId = resolved
  } else {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

    const { data: member } = await supabase
      .from('team_members')
      .select('team_id, role')
      .eq('user_id', user.id)
      .single()

    if (!member || member.role === 'viewer') {
      return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
    }
    teamId = member.team_id
  }

  const svc = createServiceClient()
  const { data, error } = await svc
    .from('content_pieces')
    .insert({
      team_id: teamId,
      title: parsed.data.title,
      platform: parsed.data.platform,
      idea_text: parsed.data.idea_text,
      source: parsed.data.source,
      status: 'idea',
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data, { status: 201 })
}
