// /api/query/find-lead?q=...
// Procura leads por nome (ilike). Devolve top 5 com summary do perfil.
// Usado pela tool query_crm_find_lead do Hub.

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
  const q = (url.searchParams.get('q') ?? '').trim()
  if (q.length < 2) {
    return NextResponse.json({ error: 'q minimo 2 caracteres' }, { status: 400 })
  }

  // Sanitiza pattern (semelhante ao /dashboard/leads)
  const safe = q.replace(/[%,()*]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
  const pattern = `%${safe}%`

  const svc = createServiceClient()
  const { data: leads, error } = await svc
    .from('leads')
    .select(`
      id, full_name, phone, email, status, score, urgency, lead_type,
      last_contact_at, created_at, deal_value, commission_value, closed_at,
      lead_profiles(summary, confidence_score)
    `)
    .eq('team_id', teamId)
    .or(`full_name.ilike.${pattern},phone.ilike.${pattern},email.ilike.${pattern}`)
    .order('updated_at', { ascending: false })
    .limit(5)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const results = (leads ?? []).map((l) => {
    const profile = Array.isArray(l.lead_profiles) ? l.lead_profiles[0] : l.lead_profiles
    return {
      id: l.id,
      full_name: l.full_name,
      phone: l.phone,
      email: l.email,
      status: l.status,
      lead_type: l.lead_type ?? 'unknown',
      score: l.score,
      urgency: l.urgency,
      last_contact_at: l.last_contact_at,
      created_at: l.created_at,
      summary: profile?.summary ?? null,
      deal_value: l.deal_value,
      commission_value: l.commission_value,
      closed_at: l.closed_at,
    }
  })

  return NextResponse.json({ count: results.length, results })
}
