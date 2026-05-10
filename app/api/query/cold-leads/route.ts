// /api/query/cold-leads?min_days=14
// Lista leads frias (sem contacto ha N dias, nao won/lost).
// Usado pela tool query_crm_cold_leads.

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { isHubAuthorized, resolveTeamId } from '@/lib/hub-auth'

export async function GET(request: Request) {
  if (!isHubAuthorized(request)) {
    return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })
  }
  const teamId = resolveTeamId(request)
  if (!teamId) return NextResponse.json({ error: 'team_id em falta' }, { status: 400 })

  const url = new URL(request.url)
  const minDays = Math.max(1, parseInt(url.searchParams.get('min_days') ?? '14', 10) || 14)
  const cutoff = new Date(Date.now() - minDays * 24 * 60 * 60 * 1000).toISOString()

  const svc = createServiceClient()
  const { data: leads, error } = await svc
    .from('leads')
    .select('id, full_name, phone, status, score, urgency, last_contact_at, created_at, lead_type')
    .eq('team_id', teamId)
    .not('status', 'in', '(won,lost)')
    .or(`last_contact_at.lt.${cutoff},and(last_contact_at.is.null,created_at.lt.${cutoff})`)
    .order('last_contact_at', { ascending: true, nullsFirst: true })
    .limit(50)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const now = Date.now()
  const enriched = (leads ?? []).map((l) => {
    const ref = l.last_contact_at ?? l.created_at
    const daysIdle = Math.floor((now - new Date(ref as string).getTime()) / (24 * 60 * 60 * 1000))
    return {
      id: l.id,
      full_name: l.full_name,
      phone: l.phone,
      status: l.status,
      lead_type: l.lead_type ?? 'unknown',
      score: l.score,
      urgency: l.urgency,
      days_idle: daysIdle,
      last_contact_at: l.last_contact_at,
    }
  })

  return NextResponse.json({ min_days: minDays, count: enriched.length, leads: enriched })
}
