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
  source_url: z.string().url().max(2000).optional().nullable(),
  source_images: z.array(z.string().url()).max(20).default([]),
  auto_imported: z.boolean().default(false),
}).refine(
  (data) => {
    if (data.negotiated_price != null && data.asking_price != null) {
      return data.negotiated_price <= data.asking_price * 2
    }
    return true
  },
  { message: 'negotiated_price parece demasiado alto face ao asking_price', path: ['negotiated_price'] }
)

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

  // Support API key auth for scraper/N8N (no session cookie available)
  const apiKey = request.headers.get('X-API-Key')
  let teamId: string | null = null

  if (apiKey) {
    const { hashApiKey } = await import('@/lib/api-keys')
    const keyHash = hashApiKey(apiKey)
    const { data: apiKeyRow } = await supabase
      .from('team_api_keys')
      .select('team_id, id')
      .eq('key_hash', keyHash)
      .is('revoked_at', null)
      .single()

    if (apiKeyRow) {
      teamId = apiKeyRow.team_id
      // Actualizar last_used_at de forma assíncrona (não bloqueia a resposta)
      void Promise.resolve(
        supabase
          .from('team_api_keys')
          .update({ last_used_at: new Date().toISOString() })
          .eq('id', apiKeyRow.id)
      ).catch(() => {})
    }
  }

  if (!teamId) {
    // Standard session auth
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

    const { data: member } = await supabase
      .from('team_members')
      .select('team_id')
      .eq('user_id', user.id)
      .single()

    if (!member) return NextResponse.json({ error: 'Equipa não encontrada' }, { status: 403 })
    teamId = member.team_id
  }

  const body = await request.json()
  const parsed = opportunitySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  let data: Record<string, unknown> | null = null
  let isNew = true

  if (parsed.data.source_url) {
    const { data: existing } = await supabase
      .from('opportunities')
      .select('id, asking_price')
      .eq('team_id', teamId)
      .eq('source_url', parsed.data.source_url)
      .maybeSingle()

    if (existing) {
      isNew = false
      const { data: updated, error: updateError } = await supabase
        .from('opportunities')
        .update({ asking_price: parsed.data.asking_price, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
        .select()
        .single()
      if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })
      data = updated
    }
  }

  if (isNew) {
    const { data: inserted, error: insertError } = await supabase
      .from('opportunities')
      .insert({ ...parsed.data, team_id: teamId })
      .select()
      .single()
    if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 })
    data = inserted
  }

  // Fire-and-forget: trigger matching async for new opportunities only
  if (isNew && data && (data as { id?: string }).id) {
    const oppId = (data as { id: string }).id
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
    fetch(`${baseUrl}/api/agents/matching`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Secret': process.env.INTERNAL_SECRET ?? 'not-configured',
      },
      body: JSON.stringify({ opportunity_id: oppId }),
    }).catch((err) => console.error('[matching trigger] erro:', err))
  }

  return NextResponse.json(data, { status: isNew ? 201 : 200 })
}
