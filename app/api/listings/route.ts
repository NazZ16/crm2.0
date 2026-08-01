import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const listingSchema = z.object({
  reference: z.string().max(100).optional().nullable(),
  title: z.string().min(1).max(300),
  business_type: z.enum(['venda', 'arrendamento']).default('venda'),
  property_type: z.enum(['apartamento', 'moradia', 'terreno', 'comercial', 'garagem', 'outro']).default('apartamento'),
  typology: z.string().max(20).optional().nullable(),
  price: z.number().nonnegative().optional().nullable(),
  condo_fee: z.number().nonnegative().optional().nullable(),
  imi_annual: z.number().nonnegative().optional().nullable(),

  district: z.string().max(150).optional().nullable(),
  municipality: z.string().max(150).optional().nullable(),
  parish: z.string().max(150).optional().nullable(),
  zone: z.string().max(150).optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  zip_code: z.string().max(20).optional().nullable(),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),

  area_useful_m2: z.number().nonnegative().optional().nullable(),
  area_gross_m2: z.number().nonnegative().optional().nullable(),
  area_plot_m2: z.number().nonnegative().optional().nullable(),
  bedrooms: z.number().int().min(0).optional().nullable(),
  bathrooms: z.number().int().min(0).optional().nullable(),
  total_rooms: z.number().int().min(0).optional().nullable(),
  parking_spaces: z.number().int().min(0).optional().nullable(),
  has_elevator: z.boolean().optional().nullable(),
  construction_year: z.number().int().min(1800).max(2100).optional().nullable(),
  energy_rating: z.string().max(10).optional().nullable(),

  features: z.array(z.string().max(100)).max(100).default([]),
  description: z.string().max(10000).optional().nullable(),
  cover_image_url: z.string().url().max(2000).optional().nullable(),

  source: z.string().max(100).optional(),
  source_url: z.string().url().max(2000).optional().nullable(),
  status: z.enum(['active', 'reserved', 'sold', 'withdrawn']).default('active'),
  lead_id: z.string().uuid().optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
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
  const q = searchParams.get('q')

  let query = supabase
    .from('listings')
    .select('*')
    .eq('team_id', member.team_id)
    .order('created_at', { ascending: false })

  if (status) query = query.eq('status', status)
  if (q) {
    const safe = q.replace(/[%_\\]/g, '\\$&')
    query = query.or(`title.ilike.%${safe}%,address.ilike.%${safe}%,municipality.ilike.%${safe}%,reference.ilike.%${safe}%`)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data)
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const service = createServiceClient()

  // Suporta autenticação por API key para os scrapers (sem cookie de sessão)
  const apiKey = request.headers.get('X-API-Key')
  let teamId: string | null = null

  if (apiKey) {
    const { hashApiKey } = await import('@/lib/api-keys')
    const keyHash = hashApiKey(apiKey)
    const { data: apiKeyRow } = await service
      .from('team_api_keys')
      .select('team_id, id')
      .eq('key_hash', keyHash)
      .is('revoked_at', null)
      .single()

    if (apiKeyRow) {
      teamId = apiKeyRow.team_id
      void Promise.resolve(
        service
          .from('team_api_keys')
          .update({ last_used_at: new Date().toISOString() })
          .eq('id', apiKeyRow.id)
      ).catch(() => {})
    }
  }

  if (!teamId) {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

    const { data: member } = await supabase
      .from('team_members')
      .select('team_id, role')
      .eq('user_id', user.id)
      .single()

    if (!member || member.role === 'viewer') {
      return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
    }
    teamId = member.team_id
  }

  const body = await request.json()
  const parsed = listingSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  // Dedup por source_url (scrapers reenviam o mesmo imóvel em cada corrida)
  if (parsed.data.source_url) {
    const { data: existing } = await service
      .from('listings')
      .select('id, price')
      .eq('team_id', teamId)
      .eq('source_url', parsed.data.source_url)
      .maybeSingle()

    if (existing) {
      const { data: updated, error: updateError } = await service
        .from('listings')
        .update({ price: parsed.data.price, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
        .select()
        .single()
      if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })
      return NextResponse.json(updated, { status: 200 })
    }
  }

  const { data, error } = await service
    .from('listings')
    .insert({ ...parsed.data, team_id: teamId })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data, { status: 201 })
}
