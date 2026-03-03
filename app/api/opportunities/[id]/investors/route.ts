import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const addInvestorSchema = z.object({
  investor_id: z.string().uuid(),
  capital_invested: z.number().int().positive(),
  tipo_associado: z.enum(['E', 'P']).default('E'),
  notes: z.string().max(500).optional(),
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
    .from('opportunity_investors')
    .select('*, investors(id, name, phone, email, status)')
    .eq('opportunity_id', id)
    .eq('team_id', member.team_id)
    .order('capital_invested', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Calcular % para cada investidor
  const total = (data ?? []).reduce((sum, r) => sum + r.capital_invested, 0)
  const withPct = (data ?? []).map((r) => ({
    ...r,
    pct_share: total > 0 ? parseFloat(((r.capital_invested / total) * 100).toFixed(2)) : 0,
  }))

  return NextResponse.json({ investors: withPct, total_capital: total })
}

export async function POST(
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
  const parsed = addInvestorSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('opportunity_investors')
    .insert({
      team_id: member.team_id,
      opportunity_id: id,
      ...parsed.data,
    })
    .select('*, investors(id, name, phone, email)')
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Este investidor já está alocado neste negócio' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data, { status: 201 })
}

export async function DELETE(
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

  const { searchParams } = new URL(request.url)
  const investorId = searchParams.get('investor_id')
  if (!investorId) return NextResponse.json({ error: 'investor_id obrigatório' }, { status: 400 })

  const { error } = await supabase
    .from('opportunity_investors')
    .delete()
    .eq('opportunity_id', id)
    .eq('investor_id', investorId)
    .eq('team_id', member.team_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
