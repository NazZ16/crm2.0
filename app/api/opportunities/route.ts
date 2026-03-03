import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const opportunitySchema = z.object({
  title: z.string().min(1).max(300),
  address: z.string().max(500).optional(),
  zone: z.string().min(1).max(100),
  typology: z.string().max(10).optional(),
  property_type: z.enum(['apartment', 'house', 'commercial', 'land']).default('apartment'),
  deal_type: z.enum(['buy_to_let', 'fix_and_flip']).default('buy_to_let'),
  asking_price: z.number().int().positive(),
  negotiated_price: z.number().int().positive().optional().nullable(),
  area_m2: z.number().int().positive().optional().nullable(),
  vpt: z.number().int().positive().optional().nullable(),

  // Buy-to-let
  estimated_monthly_rent: z.number().int().positive().optional().nullable(),
  condo_fee: z.number().int().min(0).default(0),
  annual_imi: z.number().int().min(0).default(0),
  renovation_cost: z.number().int().min(0).default(0),

  // Fix & flip — aquisição
  imposto_selo_pct: z.number().min(0).max(1).default(0.008),
  escritura_cost: z.number().int().min(0).default(1000),

  // Fix & flip — financiamento
  financing_entry_pct: z.number().min(0).max(100).default(100),
  financing_interest_pct: z.number().min(0).max(30).optional().nullable(),
  financing_years: z.number().int().min(1).max(50).optional().nullable(),
  financing_stamp_duty_pct: z.number().min(0).max(1).default(0.006),
  financing_dossier: z.number().int().min(0).default(0),
  financing_evaluation: z.number().int().min(0).default(0),
  financing_formalization: z.number().int().min(0).default(0),
  financing_mortgage_registry: z.number().int().min(0).default(0),

  // Fix & flip — transitórios
  holding_months: z.number().int().min(0).default(12),
  insurance_monthly: z.number().int().min(0).default(0),
  electricity_monthly: z.number().int().min(0).default(0),
  water_monthly: z.number().int().min(0).default(0),

  // Fix & flip — obras
  construction_cost: z.number().int().min(0).default(0),
  operational_expenses: z.number().int().min(0).default(0),
  renovation_item3: z.number().int().min(0).default(0),
  renovation_item4: z.number().int().min(0).default(0),
  renovation_item5: z.number().int().min(0).default(0),

  // Fix & flip — venda
  estimated_sell_price: z.number().int().positive().optional().nullable(),
  sale_commission_pct: z.number().min(0).max(20).default(4),
  sale_commission2_pct: z.number().min(0).max(20).default(0),
  sale_commission3_pct: z.number().min(0).max(20).default(0),
  early_repayment_penalty_pct: z.number().min(0).max(5).default(0),

  // Fix & flip — split
  operator_profit_pct: z.number().min(0).max(100).default(25),
  irc_rate: z.number().min(0).max(50).default(19),
  reform_months: z.number().int().min(0).optional().nullable(),
  contract_type: z.string().max(100).optional().nullable(),

  status: z.enum(['analyzing', 'available', 'under_offer', 'closed', 'passed']).default('analyzing'),
  source: z.string().max(200).optional(),
  description: z.string().max(5000).optional(),
  lead_id: z.string().uuid().optional().nullable(),
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
  const status = searchParams.get('status')
  const deal_type = searchParams.get('deal_type')
  const zone = searchParams.get('zone')

  let query = supabase
    .from('opportunities')
    .select('*')
    .eq('team_id', member.team_id)
    .order('created_at', { ascending: false })

  if (status) query = query.eq('status', status)
  if (deal_type) query = query.eq('deal_type', deal_type)
  if (zone) query = query.ilike('zone', `%${zone}%`)

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
    .select('team_id')
    .eq('user_id', user.id)
    .single()

  if (!member) return NextResponse.json({ error: 'Equipa não encontrada' }, { status: 403 })

  const body = await request.json()
  const parsed = opportunitySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('opportunities')
    .insert({ ...parsed.data, team_id: member.team_id })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data, { status: 201 })
}
