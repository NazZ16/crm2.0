import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const updateInvestorSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  email: z.string().email().optional().nullable(),
  phone: z.string().max(30).optional().nullable(),
  investment_type: z.array(z.enum(['buy_to_let', 'buy_to_sell', 'fix_and_flip', 'commercial'])).optional(),
  budget_min: z.number().int().positive().optional().nullable(),
  budget_max: z.number().int().positive().optional().nullable(),
  preferred_zones: z.array(z.string()).optional(),
  preferred_typologies: z.array(z.string()).optional(),
  min_yield: z.number().min(0).max(100).optional().nullable(),
  risk_level: z.enum(['conservative', 'moderate', 'aggressive']).optional(),
  investment_horizon: z.enum(['short', 'medium', 'long']).optional(),
  needs_financing: z.boolean().optional(),
  max_renovation: z.enum(['none', 'light', 'medium', 'full']).optional(),
  notes: z.string().max(2000).optional().nullable(),
  status: z.enum(['active', 'inactive', 'invested']).optional(),
  last_contact: z.string().optional().nullable(),
})

export async function GET(
  _request: Request,
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

  const { data, error } = await supabase
    .from('investors')
    .select('*')
    .eq('id', id)
    .eq('team_id', member.team_id)
    .single()

  if (error || !data) return NextResponse.json({ error: 'Investidor não encontrado' }, { status: 404 })

  // Buscar matches do investidor
  const { data: matches } = await supabase
    .from('investor_matches')
    .select('*, opportunities(*)')
    .eq('investor_id', id)
    .eq('team_id', member.team_id)
    .order('match_score', { ascending: false })

  return NextResponse.json({ ...data, matches: matches ?? [] })
}

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
    .select('team_id')
    .eq('user_id', user.id)
    .single()

  if (!member) return NextResponse.json({ error: 'Equipa não encontrada' }, { status: 403 })

  const body = await request.json()
  const parsed = updateInvestorSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('investors')
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
    .from('investors')
    .delete()
    .eq('id', id)
    .eq('team_id', member.team_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
