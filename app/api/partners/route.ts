import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const PARTNER_CATEGORIES = [
  'credito', 'advogado', 'seguradora', 'fiscalizador', 'empreiteiro',
  'eletricista', 'canalizador', 'pintor', 'eletrodomesticos', 'limpeza',
  'transportadora', 'outro',
] as const

const createPartnerSchema = z.object({
  name: z.string().min(1).max(200),
  category: z.enum(PARTNER_CATEGORIES),
  phone: z.string().max(30).optional().nullable(),
  email: z.string().email().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
})

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
  const category = searchParams.get('category')

  let query = supabase
    .from('partners')
    .select('*')
    .eq('team_id', member.team_id)
    .order('name', { ascending: true })

  if (category) query = query.eq('category', category)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data)
}

export async function POST(request: Request) {
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
  const parsed = createPartnerSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('partners')
    .insert({ ...parsed.data, team_id: member.team_id })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data, { status: 201 })
}
