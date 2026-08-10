import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse, after } from 'next/server'
import { listingSchema } from '@/lib/schemas/listing'
import { buildListingEmbeddingText, regenerateListingEmbedding } from '@/lib/embeddings'

// Campos cujo conteúdo entra no texto do embedding semântico. "price" fica
// de fora: já é coberto de forma determinística pelo hard-filter de
// orçamento em lib/listing-matching-engine.ts, e é o campo que mais muda em
// cada re-scrape — regenerar o embedding a cada alteração de preço seria
// uma chamada OpenAI desperdiçada sem ganho semântico real.
const LISTING_EMBEDDING_TRIGGER_FIELDS = new Set([
  'title', 'description', 'zone', 'municipality', 'parish', 'district',
  'typology', 'property_type', 'business_type', 'features',
])

export async function GET(request: Request) {
  const supabase = await createClient()
  const service = createServiceClient()

  // Suporta autenticação por API key para os scrapers (sem cookie de sessão) —
  // usado para consultar quais imóveis já existem antes de os reimportar.
  const apiKey = request.headers.get('X-API-Key')
  let teamId: string | null = null
  let usedApiKey = false

  if (apiKey) {
    const { hashApiKey } = await import('@/lib/api-keys')
    const keyHash = hashApiKey(apiKey)
    const { data: apiKeyRow } = await service
      .from('team_api_keys')
      .select('team_id')
      .eq('key_hash', keyHash)
      .is('revoked_at', null)
      .single()
    if (apiKeyRow) {
      teamId = apiKeyRow.team_id
      usedApiKey = true
    }
  }

  if (!teamId) {
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

  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')
  const q = searchParams.get('q')

  let query = (usedApiKey ? service : supabase)
    .from('listings')
    .select('*')
    .eq('team_id', teamId)
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

  // Dedup por source_url (scrapers reenviam o mesmo imóvel em cada corrida).
  // Só atualiza os campos que vierem mesmo no pedido — um reimport "leve"
  // (ex.: só preço/estado/publicado, para poupar tempo de scraping) não deve
  // apagar dados ricos já guardados com os valores por omissão do schema
  // (features: [], photos: [], etc). lead_id/notas ficam sempre de fora —
  // são geridos à mão no CRM, nunca pelo scraper.
  if (parsed.data.source_url) {
    const { data: existing } = await service
      .from('listings')
      .select('id')
      .eq('team_id', teamId)
      .eq('source_url', parsed.data.source_url)
      .maybeSingle()

    if (existing) {
      const sentKeys = Object.keys(body as Record<string, unknown>)
      const parsedData = parsed.data as Record<string, unknown>
      const updatePayload: Record<string, unknown> = { updated_at: new Date().toISOString() }
      for (const key of sentKeys) {
        if (key === 'lead_id' || key === 'notes') continue
        if (key in parsedData) updatePayload[key] = parsedData[key]
      }

      const { data: updated, error: updateError } = await service
        .from('listings')
        .update(updatePayload)
        .eq('id', existing.id)
        .select()
        .single()
      if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

      if (Object.keys(updatePayload).some((k) => LISTING_EMBEDDING_TRIGGER_FIELDS.has(k))) {
        after(
          regenerateListingEmbedding(service, updated.id, buildListingEmbeddingText(updated)).catch((err) =>
            console.warn('[embeddings] listing update', updated.id, err)
          )
        )
      }
      return NextResponse.json(updated, { status: 200 })
    }
  }

  const { data, error } = await service
    .from('listings')
    .insert({ ...parsed.data, team_id: teamId })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  after(
    regenerateListingEmbedding(service, data.id, buildListingEmbeddingText(data)).catch((err) =>
      console.warn('[embeddings] listing insert', data.id, err)
    )
  )

  return NextResponse.json(data, { status: 201 })
}
