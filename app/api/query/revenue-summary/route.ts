// /api/query/revenue-summary
// Resumo de faturacao YTD vs target, mes corrente, deals fechadas.
// Usado pela tool query_crm_revenue do Hub.

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { isHubAuthorized, resolveTeamId } from '@/lib/hub-auth'

const YEARLY_REVENUE_TARGET_EUR = 50_000

export async function GET(request: Request) {
  if (!isHubAuthorized(request)) {
    return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })
  }
  const teamId = resolveTeamId(request)
  if (!teamId) return NextResponse.json({ error: 'team_id em falta' }, { status: 400 })

  const svc = createServiceClient()
  const now = new Date()
  const year = now.getFullYear()
  const startOfYear = new Date(year, 0, 1).toISOString()
  const startOfNextYear = new Date(year + 1, 0, 1).toISOString()
  const startOfMonth = new Date(year, now.getMonth(), 1).toISOString()

  const { data: closed, error } = await svc
    .from('leads')
    .select('id, full_name, commission_value, deal_value, closed_at')
    .eq('team_id', teamId)
    .eq('status', 'won')
    .not('closed_at', 'is', null)
    .gte('closed_at', startOfYear)
    .lt('closed_at', startOfNextYear)
    .order('closed_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const all = (closed ?? []) as Array<{
    id: string
    full_name: string
    commission_value: number | null
    deal_value: number | null
    closed_at: string | null
  }>

  const totalYtd = all.reduce((s, l) => s + (l.commission_value ?? 0), 0)
  const monthDeals = all.filter((l) => l.closed_at && l.closed_at >= startOfMonth)
  const totalMonth = monthDeals.reduce((s, l) => s + (l.commission_value ?? 0), 0)

  const dayOfYear = Math.floor((now.getTime() - new Date(year, 0, 1).getTime()) / 86400000) + 1
  const daysInYear = ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0) ? 366 : 365
  const expectedYtd = (YEARLY_REVENUE_TARGET_EUR * dayOfYear) / daysInYear
  const paceDelta = totalYtd - expectedYtd

  return NextResponse.json({
    year,
    target_eur: YEARLY_REVENUE_TARGET_EUR,
    total_ytd_eur: Math.round(totalYtd),
    total_month_eur: Math.round(totalMonth),
    deals_count: all.length,
    deals_this_month: monthDeals.length,
    percent_of_target: Math.min(100, Math.round((totalYtd / YEARLY_REVENUE_TARGET_EUR) * 100)),
    expected_ytd_eur: Math.round(expectedYtd),
    pace_delta_eur: Math.round(paceDelta),
    on_pace: totalYtd >= expectedYtd,
    remaining_eur: Math.max(0, Math.round(YEARLY_REVENUE_TARGET_EUR - totalYtd)),
    recent_deals: all.slice(0, 5).map((l) => ({
      id: l.id,
      lead_name: l.full_name,
      commission_eur: l.commission_value,
      closed_at: l.closed_at,
    })),
  })
}
