import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const updateOpportunitySchema = z.object({
  title: z.string().min(1).max(300).optional(),
  address: z.string().max(500).optional().nullable(),
  zone: z.string().min(1).max(100).optional(),
  typology: z.string().max(10).optional().nullable(),
  property_type: z.enum(['apartment', 'house', 'commercial', 'land']).optional(),
  asking_price: z.number().int().positive().optional(),
  negotiated_price: z.number().int().positive().optional().nullable(),
  estimated_monthly_rent: z.number().int().positive().optional().nullable(),
  condo_fee: z.number().int().min(0).optional(),
  annual_imi: z.number().int().min(0).optional(),
  renovation_cost: z.number().int().min(0).optional(),
  estimated_sell_price: z.number().int().positive().optional().nullable(),
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

  // Buscar matches com investidores
  const { data: matches } = await supabase
    .from('investor_matches')
    .select('*, investors(*)')
    .eq('opportunity_id', id)
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
  const parsed = updateOpportunitySchema.safeParse(body)
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
