import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse, after } from 'next/server'
import { z } from 'zod'
import { buildListingEmbeddingText, regenerateListingEmbedding } from '@/lib/embeddings'

const LISTING_EMBEDDING_TRIGGER_FIELDS = new Set([
  'title', 'description', 'zone', 'municipality', 'parish', 'district',
  'typology', 'property_type', 'business_type', 'features',
])

const updateListingSchema = z.object({
  reference: z.string().max(100).nullable().optional(),
  title: z.string().min(1).max(300).optional(),
  business_type: z.enum(['venda', 'arrendamento']).optional(),
  property_type: z.enum(['apartamento', 'moradia', 'terreno', 'comercial', 'garagem', 'outro', 'quinta', 'loja', 'armazem', 'escritorio', 'predio']).optional(),
  typology: z.string().max(20).nullable().optional(),
  price: z.number().nonnegative().nullable().optional(),
  condo_fee: z.number().nonnegative().nullable().optional(),
  imi_annual: z.number().nonnegative().nullable().optional(),

  district: z.string().max(150).nullable().optional(),
  municipality: z.string().max(150).nullable().optional(),
  parish: z.string().max(150).nullable().optional(),
  zone: z.string().max(150).nullable().optional(),
  address: z.string().max(500).nullable().optional(),
  zip_code: z.string().max(20).nullable().optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),

  area_useful_m2: z.number().nonnegative().nullable().optional(),
  area_gross_m2: z.number().nonnegative().nullable().optional(),
  area_plot_m2: z.number().nonnegative().nullable().optional(),
  bedrooms: z.number().int().min(0).nullable().optional(),
  bathrooms: z.number().int().min(0).nullable().optional(),
  total_rooms: z.number().int().min(0).nullable().optional(),
  parking_spaces: z.number().int().min(0).nullable().optional(),
  has_elevator: z.boolean().nullable().optional(),
  construction_year: z.number().int().min(1800).max(2100).nullable().optional(),
  energy_rating: z.string().max(20).nullable().optional(),

  features: z.array(z.string().max(100)).max(100).optional(),
  description: z.string().max(10000).nullable().optional(),
  cover_image_url: z.string().url().max(2000).nullable().optional(),
  photos: z.array(z.string().url().max(2000)).max(50).optional(),

  source: z.string().max(100).optional(),
  source_url: z.string().url().max(2000).nullable().optional(),
  status: z.enum(['active', 'reserved', 'sold', 'withdrawn']).optional(),
  is_published: z.boolean().nullable().optional(),
  lead_id: z.string().uuid().nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),

  sold_price: z.number().nonnegative().nullable().optional(),
  buyer_lead_id: z.string().uuid().nullable().optional(),
  sold_at: z.string().datetime().nullable().optional(),

  agent_name: z.string().max(200).nullable().optional(),
  agent_phone: z.string().max(50).nullable().optional(),
  agent_email: z.string().email().max(200).nullable().optional(),

  days_on_market: z.number().int().min(0).nullable().optional(),
  visit_count: z.number().int().min(0).nullable().optional(),
  proposal_count: z.number().int().min(0).nullable().optional(),
})

async function getMember(userId: string) {
  const supabase = await createClient()
  const { data: member } = await supabase
    .from('team_members')
    .select('team_id, role')
    .eq('user_id', userId)
    .single()
  return { supabase, member }
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { member } = await getMember(user.id)
  if (!member) return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })

  const { data, error } = await supabase
    .from('listings')
    .select('*, seller:leads!listings_lead_id_fkey(id,full_name,phone,email), buyer:leads!listings_buyer_lead_id_fkey(id,full_name,phone,email)')
    .eq('id', id)
    .eq('team_id', member.team_id)
    .single()

  if (error) return NextResponse.json({ error: 'Imóvel não encontrado' }, { status: 404 })

  return NextResponse.json(data)
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { member } = await getMember(user.id)
  if (!member) return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
  if (member.role === 'viewer') return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })

  const body = await request.json()
  const parsed = updateListingSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const service = createServiceClient()
  const { data, error } = await service
    .from('listings')
    .update(parsed.data)
    .eq('id', id)
    .eq('team_id', member.team_id)
    .select('*, seller:leads!listings_lead_id_fkey(id,full_name,phone,email), buyer:leads!listings_buyer_lead_id_fkey(id,full_name,phone,email)')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Imóvel não encontrado' }, { status: 404 })

  const changedFields = Object.keys(parsed.data)
  if (changedFields.some((k) => LISTING_EMBEDDING_TRIGGER_FIELDS.has(k))) {
    after(
      regenerateListingEmbedding(service, data.id, buildListingEmbeddingText(data)).catch((err) =>
        console.warn('[embeddings] listing patch', data.id, err)
      )
    )
  }

  return NextResponse.json(data)
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { member } = await getMember(user.id)
  if (!member) return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
  if (member.role === 'viewer') return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })

  const service = createServiceClient()
  const { error } = await service
    .from('listings')
    .delete()
    .eq('id', id)
    .eq('team_id', member.team_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
