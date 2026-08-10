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

  const { data: listings } = await service
    .from('listings')
    .select('id, title, description, zone, municipality, parish, district, typology, property_type, business_type, features, price')
    .eq('team_id', teamId)
    .is('embedding', null)
    .limit(limit)

  for (const l of listings ?? []) {
    await regenerateListingEmbedding(service, l.id, buildListingEmbeddingText(l))
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
        .limit(limit)
    : { data: [] }

  for (const p of profiles ?? []) {
    await regenerateLeadProfileEmbedding(
      service,
      p.lead_id,
      buildLeadPreferenceEmbeddingText(p.home_preferences, notesByLeadId.get(p.lead_id) ?? null)
    )
  }

  const listingsDone = listings?.length ?? 0
  const leadsDone = profiles?.length ?? 0

  return NextResponse.json({
    listingsDone,
    leadsDone,
    hasMore: listingsDone === limit || leadsDone === limit,
  })
}
