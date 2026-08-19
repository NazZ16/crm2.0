// /api/cron/weekly-lead-analysis
// Vercel Cron semanal: corre a Segunda-feira as 5h UTC (antes do stale-leads e do
// morning-briefing). Analisa, via lib/lead-analysis.ts, todas as leads que tiveram pelo menos
// uma interacao nos ultimos 7 dias — mantem o custo de IA controlado (nada corre por
// mensagem, so uma vez por semana e so para quem teve conversa nova).

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { runWeeklyLeadAnalysis } from '@/lib/weekly-lead-analysis'

export const maxDuration = 300

function isAuthorized(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return true

  const authHeader = request.headers.get('authorization')
  if (authHeader === `Bearer ${cronSecret}`) return true

  const url = new URL(request.url)
  if (url.searchParams.get('secret') === cronSecret) return true

  return false
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })
  }

  try {
    const svc = createServiceClient()
    const outcomes = await runWeeklyLeadAnalysis(svc)
    const analyzed = outcomes.filter((o) => o.status === 'ok').length
    return NextResponse.json({ ok: true, analyzed, total: outcomes.length, details: outcomes })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'erro desconhecido'
    console.error('[weekly-lead-analysis cron] erro:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
