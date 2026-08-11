// app/api/embeddings/backfill/route.ts
// Preenche embeddings em falta para listings/lead_profiles já existentes
// (dados de antes desta funcionalidade, ou entrados via app/api/listings/
// bulk|import, que não disparam geração automática — ver comentário nesses
// ficheiros). Idempotente e reentrante: cada chamada processa até `limit`
// registos com embedding IS NULL e devolve hasMore para o caller repetir.

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import {
  buildListingEmbeddingText,
  buildLeadPreferenceEmbeddingText,
  regenerateListingEmbedding,
  regenerateLeadProfileEmbedding,
} from '@/lib/embeddings'

export const maxDuration = 60

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: member } = await supabase
    .from('team_members').select('team_id, role').eq('user_id', user.id).single()
  if (!member || member.role === 'viewer') {
    return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const limit = Math.min(Math.max(Number(body?.limit) || 25, 1), 50)
  const service = createServiceClient()
  const teamId = member.team_id

  // .is('embedding_updated_at', null) exclui registos já "vistos" numa
  // corrida anterior — sem isto, uma lead/listing sem texto nenhum para
  // embutir (sem home_preferences/notas, ex.) ficaria para sempre com
  // embedding NULL e seria reselecionada em todas as chamadas seguintes,
  // nunca deixando o backfill convergir.
  const { data: listings } = await service
    .from('listings')
    .select('id, title, description, zone, municipality, parish, district, typology, property_type, business_type, features, price')
    .eq('team_id', teamId)
    .is('embedding', null)
    .is('embedding_updated_at', null)
    .limit(limit)

  let listingsOk = 0
  let listingsFailed = 0
  let listingsSkipped = 0
  let sampleError: string | undefined

  for (const l of listings ?? []) {
    const text = buildListingEmbeddingText(l)
    if (!text.trim()) {
      listingsSkipped++
      await service.from('listings').update({ embedding_updated_at: new Date().toISOString() }).eq('id', l.id)
      continue
    }
    const result = await regenerateListingEmbedding(service, l.id, text)
    if (result.ok) listingsOk++
    else {
      listingsFailed++
      sampleError ??= `listing ${l.id}: ${result.error}`
    }
  }

  const { data: teamLeads } = await service.from('leads').select('id, notes').eq('team_id', teamId)
  const leadIds = (teamLeads ?? []).map((l) => l.id)
  const notesByLeadId = new Map((teamLeads ?? []).map((l) => [l.id, l.notes as string | null]))

  const { data: profiles } = leadIds.length
    ? await service
        .from('lead_profiles')
        .select('lead_id, home_preferences')
        .in('lead_id', leadIds)
        .is('embedding', null)
        .is('embedding_updated_at', null)
        .limit(limit)
    : { data: [] }

  let leadsOk = 0
  let leadsFailed = 0
  let leadsSkipped = 0

  for (const p of profiles ?? []) {
    const text = buildLeadPreferenceEmbeddingText(p.home_preferences, notesByLeadId.get(p.lead_id) ?? null)
    if (!text.trim()) {
      leadsSkipped++
      await service.from('lead_profiles').update({ embedding_updated_at: new Date().toISOString() }).eq('lead_id', p.lead_id)
      continue
    }
    const result = await regenerateLeadProfileEmbedding(service, p.lead_id, text)
    if (result.ok) leadsOk++
    else {
      leadsFailed++
      sampleError ??= `lead ${p.lead_id}: ${result.error}`
    }
  }

  const listingsAttempted = listings?.length ?? 0
  const leadsAttempted = profiles?.length ?? 0

  // Só reporta hasMore se algo progrediu de facto (sucesso OU skip conta
  // como progresso — ambos removem o registo do conjunto "por processar").
  // Evita ciclo infinito no cliente quando a geração falha sistematicamente
  // (chave OpenAI inválida, quota esgotada) em vez de mascarar isso como
  // progresso.
  const madeProgress = listingsOk > 0 || leadsOk > 0 || listingsSkipped > 0 || leadsSkipped > 0
  const hasMore = madeProgress && (listingsAttempted === limit || leadsAttempted === limit)

  return NextResponse.json({
    listingsOk,
    listingsFailed,
    listingsSkipped,
    leadsOk,
    leadsFailed,
    leadsSkipped,
    hasMore,
    sampleError,
  })
}
