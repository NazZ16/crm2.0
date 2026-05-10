// /api/cron/stale-leads
// Vercel Cron diario: corre as 6h UTC (antes do briefing).
// Para cada lead em qualified/meeting/active sem contacto ha demasiado tempo,
// cria task "Recontactar — Nome" para entrar no briefing matinal.

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { processStaleLeads } from '@/lib/stale-leads'

export const maxDuration = 60

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
    const created = await processStaleLeads(svc)
    return NextResponse.json({ ok: true, created: created.length, details: created })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'erro desconhecido'
    console.error('[stale-leads cron] erro:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
