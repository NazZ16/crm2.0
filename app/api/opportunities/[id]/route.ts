import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const updateSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  address: z.string().max(500).optional().nullable(),
  zone: z.string().min(1).max(100).optional(),
  typology: z.string().max(10).optional().nullable(),
  property_type: z.enum(['apartment', 'house', 'commercial', 'land']).optional(),
  deal_type: z.enum(['buy_to_let', 'fix_and_flip']).optional(),
  asking_price: z.number().int().positive().optional(),
  negotiated_price: z.number().int().positive().optional().nullable(),
  area_m2: z.number().int().positive().optional().nullable(),
  vpt: z.number().int().positive().optional().nullable(),
  estimated_monthly_rent: z.number().int().positive().optional().nullable(),
  condo_fee: z.number().int().min(0).optional(),
  annual_imi: z.number().int().min(0).optional(),
  renovation_cost: z.number().int().min(0).optional(),
  imposto_selo_pct: z.number().min(0).max(1).optional(),
  escritura_cost: z.number().int().min(0).optional(),
  financing_entry_pct: z.number().min(0).max(100).optional(),
  financing_interest_pct: z.number().min(0).max(30).optional().nullable(),
  financing_years: z.number().int().min(1).max(50).optional().nullable(),
  financing_stamp_duty_pct: z.number().min(0).max(1).optional(),
  financing_dossier: z.number().int().min(0).optional(),
  financing_evaluation: z.number().int().min(0).optional(),
  financing_formalization: z.number().int().min(0).optional(),
  financing_mortgage_registry: z.number().int().min(0).optional(),
  holding_months: z.number().int().min(0).optional(),
  insurance_monthly: z.number().int().min(0).optional(),
  electricity_monthly: z.number().int().min(0).optional(),
  water_monthly: z.number().int().min(0).optional(),
  construction_cost: z.number().int().min(0).optional(),
  operational_expenses: z.number().int().min(0).optional(),
  renovation_item3: z.number().int().min(0).optional(),
  renovation_item4: z.number().int().min(0).optional(),
  renovation_item5: z.number().int().min(0).optional(),
  estimated_sell_price: z.number().int().positive().optional().nullable(),
  sale_commission_pct: z.number().min(0).max(20).optional(),
  sale_commission2_pct: z.number().min(0).max(20).optional(),
  sale_commission3_pct: z.number().min(0).max(20).optional(),
  early_repayment_penalty_pct: z.number().min(0).max(5).optional(),
  operator_profit_pct: z.number().min(0).max(100).optional(),
  irc_rate: z.number().min(0).max(50).optional(),
  reform_months: z.number().int().min(0).optional().nullable(),
  contract_type: z.string().max(100).optional().nullable(),
  status: z.enum(['analyzing', 'available', 'under_offer', 'closed', 'passed']).optional(),
  source: z.string().max(200).optional().nullable(),
  description: z.string().max(5000).optional().nullable(),
  lead_id: z.string().uuid().optional().nullable(),
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
    .from('opportunities')
    .select('*')
    .eq('id', id)
    .eq('team_id', member.team_id)
    .single()

  if (error || !data) return NextResponse.json({ error: 'Oportunidade não encontrada' }, { status: 404 })

  // Matches IA
  const { data: matches } = await supabase
    .from('investor_matches')
    .select('*, investors(*)')
    .eq('opportunity_id', id)
    .eq('team_id', member.team_id)
    .order('match_score', { ascending: false })

  // Investidores realmente alocados
  const { data: dealInvestors } = await supabase
    .from('opportunity_investors')
    .select('*, investors(id, name, phone, email, status)')
    .eq('opportunity_id', id)
    .eq('team_id', member.team_id)
    .order('capital_invested', { ascending: false })

  return NextResponse.json({
    ...data,
    matches: matches ?? [],
    deal_investors: dealInvestors ?? [],
  })
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
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('opportunities')
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
    .from('opportunities')
    .delete()
    .eq('id', id)
    .eq('team_id', member.team_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
