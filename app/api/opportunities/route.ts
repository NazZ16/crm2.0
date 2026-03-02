import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const createOpportunitySchema = z.object({
  title: z.string().min(1).max(300),
  address: z.string().max(500).optional(),
  zone: z.string().min(1).max(100),
  typology: z.string().max(10).optional(),
  property_type: z.enum(['apartment', 'house', 'commercial', 'land']).default('apartment'),
  asking_price: z.number().int().positive(),
  negotiated_price: z.number().int().positive().optional().nullable(),
  estimated_monthly_rent: z.number().int().positive().optional().nullable(),
  condo_fee: z.number().int().min(0).default(0),
  annual_imi: z.number().int().min(0).default(0),
  renovation_cost: z.number().int().min(0).default(0),
  estimated_sell_price: z.number().int().positive().optional().nullable(),
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
  const zone = searchParams.get('zone')

  let query = supabase
    .from('opportunities')
    .select('*')
    .eq('team_id', member.team_id)
    .order('created_at', { ascending: false })

  if (status) query = query.eq('status', status)
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
  const parsed = createOpportunitySchema.safeParse(body)
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
