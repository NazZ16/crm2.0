// /api/auth/google/disconnect
// Remove a conexao Google Calendar do team.

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST() {
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

  const svc = createServiceClient()
  await svc
    .from('team_calendar_connections')
    .delete()
    .eq('team_id', member.team_id)
    .eq('provider', 'google')

  return NextResponse.json({ ok: true })
}
