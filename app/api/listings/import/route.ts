import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse, after } from 'next/server'
import { z } from 'zod'
import { extractListingFromHtml } from '@/lib/listing-extractor'
import { notifyBuyersForNewListing } from '@/lib/agents/listing-matching-agent'

// Endpoint usado pelo bookmarklet "Importar para o CRM" — o utilizador clica
// enquanto está numa página de imóvel (ex.: Maxwork) e o browser faz POST do
// HTML da página actual. Cross-origin (a página de origem não é o CRM), por
// isso responde a CORS com Access-Control-Allow-Origin: *. Autenticação é só
// por API key (team_api_keys) — sem isto o pedido cross-origin não teria
// cookies de sessão disponíveis.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
}

const importSchema = z.object({
  raw_html: z.string().min(1).max(1_000_000),
  page_url: z.string().url().max(2000).optional(),
})

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

export async function POST(request: Request) {
  const service = createServiceClient()
  let teamId: string | null = null

  const apiKey = request.headers.get('X-API-Key')
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
        service.from('team_api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', apiKeyRow.id)
      ).catch(() => {})
    }
  }

  if (!teamId) {
    // Fallback: sessão normal (útil para testar sem API key, ex. a partir do próprio CRM)
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data: member } = await supabase.from('team_members').select('team_id').eq('user_id', user.id).single()
      if (member) teamId = member.team_id
    }
  }

  if (!teamId) {
    return NextResponse.json({ error: 'API key inválida ou em falta' }, { status: 401, headers: CORS_HEADERS })
  }

  const body = await request.json().catch(() => null)
  const parsed = importSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400, headers: CORS_HEADERS })
  }

  const extracted = extractListingFromHtml(parsed.data.raw_html)

  const fallbackTitle = extracted.reference
    ? `Imóvel ${extracted.reference}`
    : `Imóvel importado ${new Date().toLocaleDateString('pt-PT')}`

  const insertPayload = {
    team_id: teamId,
    reference: extracted.reference,
    title: extracted.title ?? fallbackTitle,
    business_type: extracted.business_type ?? 'venda',
    property_type: extracted.property_type ?? 'apartamento',
    typology: extracted.typology,
    price: extracted.price,
    condo_fee: extracted.condo_fee,
    imi_annual: extracted.imi_annual,
    district: extracted.district,
    municipality: extracted.municipality,
    parish: extracted.parish,
    address: extracted.address,
    zip_code: extracted.zip_code,
    latitude: extracted.latitude,
    longitude: extracted.longitude,
    area_useful_m2: extracted.area_useful_m2,
    area_gross_m2: extracted.area_gross_m2,
    area_plot_m2: extracted.area_plot_m2,
    bedrooms: extracted.bedrooms,
    bathrooms: extracted.bathrooms,
    total_rooms: extracted.total_rooms,
    parking_spaces: extracted.parking_spaces,
    has_elevator: extracted.has_elevator,
    construction_year: extracted.construction_year,
    energy_rating: extracted.energy_rating,
    features: extracted.features,
    description: extracted.description,
    cover_image_url: extracted.cover_image_url,
    source: 'maxwork_bookmarklet',
    source_url: parsed.data.page_url ?? extracted.source_url,
    status: 'active' as const,
  }

  const { data, error } = await service.from('listings').insert(insertPayload).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: CORS_HEADERS })

  after(
    notifyBuyersForNewListing(service, data).catch((err) =>
      console.warn('[listing-matching] notify buyers', data.id, err)
    )
  )

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
  const editUrl = `${siteUrl}/dashboard/listings/${data.id}`

  return NextResponse.json({ id: data.id, edit_url: editUrl }, { status: 201, headers: CORS_HEADERS })
}
