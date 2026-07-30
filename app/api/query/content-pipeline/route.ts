// /api/query/content-pipeline
// Ideias/rascunhos/agendados dos proximos 14 dias + contagem por estado.
// Usado pela tool get_content_pipeline do Elsio Hub.

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { isHubAuthorized, resolveTeamId } from '@/lib/hub-auth'
import { CONTENT_STATUS_ORDER, type ContentStatus } from '@/lib/types'

export async function GET(request: Request) {
  if (!isHubAuthorized(request)) {
    return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })
  }
  const teamId = resolveTeamId(request)
  if (!teamId) return NextResponse.json({ error: 'team_id em falta' }, { status: 400 })

  const svc = createServiceClient()
  const in14Days = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()

  const { data: pieces, error } = await svc
    .from('content_pieces')
    .select('id, title, platform, status, scheduled_at, published_at, published_url, created_at')
    .eq('team_id', teamId)
    .neq('status', 'archived')
    .or(`status.neq.scheduled,scheduled_at.lte.${in14Days}`)
    .order('scheduled_at', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(30)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const byStatus: Record<ContentStatus, number> = {
    idea: 0, draft: 0, scheduled: 0, published: 0, archived: 0,
  }
  for (const p of pieces ?? []) {
    const s = p.status as ContentStatus
    if (s in byStatus) byStatus[s] += 1
  }

  return NextResponse.json({
    total: pieces?.length ?? 0,
    by_status: byStatus,
    order: CONTENT_STATUS_ORDER,
    items: pieces ?? [],
  })
}
