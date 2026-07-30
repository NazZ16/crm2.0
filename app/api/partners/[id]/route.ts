import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const PARTNER_CATEGORIES = [
  'credito', 'advogado', 'seguradora', 'fiscalizador', 'empreiteiro',
  'eletricista', 'canalizador', 'pintor', 'eletrodomesticos', 'limpeza',
  'transportadora', 'outro',
] as const

const updatePartnerSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  category: z.enum(PARTNER_CATEGORIES).optional(),
  phone: z.string().max(30).optional().nullable(),
  email: z.string().email().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
})

export async function PATCH(
  request: Request,
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

  if (!member) return NextResponse.json({ error: 'Equipa não encontrada' }, { status: 403 })
  if (member.role === 'viewer') return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })

  const body = await request.json()
  const parsed = updatePartnerSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('partners')
    .update(parsed.data)
    .eq('id', id)
    .eq('team_id', member.team_id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data)
}

export async function DELETE(
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

  if (!member || member.role === 'viewer') {
    return NextResponse.json({ error: 'Permissão insuficiente' }, { status: 403 })
  }

  const { error } = await supabase
    .from('partners')
    .delete()
    .eq('id', id)
    .eq('team_id', member.team_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
