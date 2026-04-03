import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: member } = await supabase
    .from('team_members')
    .select('team_id')
    .eq('user_id', user.id)
    .single()
  if (!member) return NextResponse.json({ error: 'Equipa não encontrada' }, { status: 403 })

  const { data: upload, error } = await supabase
    .from('call_uploads')
    .select('id, status, error, lead_id, coach_feedback, audio_duration_s, processed_at')
    .eq('id', id)
    .eq('team_id', member.team_id)
    .single()

  if (error || !upload) return NextResponse.json({ error: 'Upload não encontrado' }, { status: 404 })

  return NextResponse.json(upload)
}
