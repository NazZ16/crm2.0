// /api/query/leads-counts
// Contagens de leads por status e tipo. Usado pela tool query_crm_leads_counts.

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { isHubAuthorized, resolveTeamId } from '@/lib/hub-auth'
import { LEAD_PIPELINE_ORDER, type LeadStatus, type LeadType } from '@/lib/types'

export async function GET(request: Request) {
  if (!isHubAuthorized(request)) {
    return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })
  }
  const teamId = resolveTeamId(request)
  if (!teamId) return NextResponse.json({ error: 'team_id em falta' }, { status: 400 })

  const svc = createServiceClient()
  const { data: leads, error } = await svc
    .from('leads')
    .select('status, lead_type')
    .eq('team_id', teamId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const byStatus: Record<LeadStatus, number> = {
    new: 0, qualified: 0, meeting: 0, active: 0, cpcv: 0, escriturado: 0, won: 0, lost: 0,
  }
  const byType: Record<LeadType, number> = {
    buyer: 0, seller: 0, both: 0, unknown: 0,
  }
  for (const l of leads ?? []) {
    const s = l.status as LeadStatus
    if (s in byStatus) byStatus[s] += 1
    const t = ((l.lead_type as LeadType | null | undefined) ?? 'unknown') as LeadType
    byType[t] += 1
  }

  // Activas = nao won nem lost
  const active = LEAD_PIPELINE_ORDER
    .filter((s) => s !== 'won' && s !== 'lost')
    .reduce((sum, s) => sum + byStatus[s], 0)

  return NextResponse.json({
    total: leads?.length ?? 0,
    active,
    by_status: byStatus,
    by_type: byType,
  })
}
