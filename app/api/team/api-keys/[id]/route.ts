import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

interface Props {
  params: Promise<{ id: string }>
}

export async function DELETE(_request: Request, { params }: Props) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: member } = await supabase
    .from('team_members')
    .select('team_id, role')
    .eq('user_id', user.id)
    .single()

  if (!member || member.role !== 'admin') {
    return NextResponse.json({ error: 'Apenas admins podem revogar API keys' }, { status: 403 })
  }

  // Soft delete — guarda revoked_at para auditoria
  const { error } = await supabase
    .from('team_api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .eq('team_id', member.team_id)
    .is('revoked_at', null)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
