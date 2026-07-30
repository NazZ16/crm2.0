import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { dismissExtraction } from '@/lib/apply-extraction'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: member } = await supabase
    .from('team_members')
    .select('team_id, role')
    .eq('user_id', user.id)
    .single()

  if (!member) return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
  if (member.role === 'viewer') return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })

  const { data: extraction } = await supabase
    .from('agent_extractions')
    .select('id, team_id')
    .eq('id', id)
    .eq('team_id', member.team_id)
    .single()

  if (!extraction) return NextResponse.json({ error: 'Extração não encontrada' }, { status: 404 })

  const svc = createServiceClient()
  const result = await dismissExtraction(svc, id)

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })

  return NextResponse.json(result)
}
