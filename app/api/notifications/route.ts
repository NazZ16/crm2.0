import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

// GET /api/notifications?unread=true&limit=20
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const unreadOnly = searchParams.get('unread') === 'true'
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '20', 10), 100)

  const { data: member } = await supabase
    .from('team_members')
    .select('team_id')
    .eq('user_id', user.id)
    .single()

  if (!member) return NextResponse.json({ error: 'Sem equipa' }, { status: 404 })

  let query = supabase
    .from('notifications')
    .select('*')
    .eq('team_id', member.team_id)
    .or(`user_id.eq.${user.id},user_id.is.null`)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (unreadOnly) {
    query = query.eq('read', false)
  }

  const { data: notifications, error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const unreadCount = unreadOnly
    ? (notifications ?? []).length
    : (notifications ?? []).filter((n) => !n.read).length

  return NextResponse.json({ notifications: notifications ?? [], unread_count: unreadCount })
}

const markReadSchema = z.object({
  ids: z.array(z.string().uuid()).optional(),
  all: z.boolean().optional(),
})

// PATCH /api/notifications — mark read
// body: { ids: string[] } or { all: true }
export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const body = await request.json()
  const parsed = markReadSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Payload inválido' }, { status: 400 })
  }

  const { ids, all } = parsed.data

  if (!ids?.length && !all) {
    return NextResponse.json({ error: 'Especifica ids ou all: true' }, { status: 400 })
  }

  const { data: member } = await supabase
    .from('team_members')
    .select('team_id')
    .eq('user_id', user.id)
    .single()

  if (!member) return NextResponse.json({ error: 'Sem equipa' }, { status: 404 })

  let updateQuery = supabase
    .from('notifications')
    .update({ read: true })
    .eq('team_id', member.team_id)
    .or(`user_id.eq.${user.id},user_id.is.null`)

  if (!all && ids?.length) {
    updateQuery = updateQuery.in('id', ids)
  }

  const { error } = await updateQuery

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
