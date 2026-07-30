import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const updateContentSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  platform: z.enum(['linkedin', 'instagram', 'tiktok', 'youtube', 'blog', 'other']).optional(),
  status: z.enum(['idea', 'draft', 'scheduled', 'published', 'archived']).optional(),
  draft_content: z.string().max(10000).nullable().optional(),
  scheduled_at: z.string().datetime().nullable().optional(),
  published_at: z.string().datetime().nullable().optional(),
  published_url: z.string().url().max(500).nullable().optional(),
})

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: member } = await supabase
    .from('team_members')
    .select('team_id, role')
    .eq('user_id', user.id)
    .single()

  if (!member) return NextResponse.json({ error: 'Não encontrado' }, { status: 404 })
  if (member.role === 'viewer') return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })

  const body = await request.json()
  const parsed = updateContentSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Dados inválidos', details: parsed.error.flatten() }, { status: 400 })
  }

  const updates: Record<string, unknown> = { ...parsed.data }
  // Auto-preencher published_at quando se marca como 'published' sem data explicita
  if (updates.status === 'published' && !('published_at' in updates)) {
    updates.published_at = new Date().toISOString()
  }

  const svc = createServiceClient()
  const { data, error } = await svc
    .from('content_pieces')
    .update(updates)
    .eq('id', id)
    .eq('team_id', member.team_id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Não encontrado' }, { status: 404 })

  return NextResponse.json(data)
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: member } = await supabase
    .from('team_members')
    .select('team_id, role')
    .eq('user_id', user.id)
    .single()

  if (!member) return NextResponse.json({ error: 'Não encontrado' }, { status: 404 })
  if (member.role === 'viewer') return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })

  const svc = createServiceClient()
  const { error } = await svc
    .from('content_pieces')
    .delete()
    .eq('id', id)
    .eq('team_id', member.team_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
