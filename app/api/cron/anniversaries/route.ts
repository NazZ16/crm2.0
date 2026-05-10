// /api/cron/anniversaries
// Vercel Cron diario: para cada lead 'won' cujo closed_at faz aniversario hoje
// (mesmo mes+dia, e ja passaram >= 2 anos), cria task de aniversario.
//
// Ano 0 (referencias) e Ano 1 sao criados no momento do active->won.
// Este cron lida com anos 2, 3, 4... ad infinitum.

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { applyAnniversaryTask } from '@/lib/auto-tasks'
import type { LeadType } from '@/lib/types'

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

  const svc = createServiceClient()
  const now = new Date()
  const todayMonth = now.getMonth() + 1 // 1-12
  const todayDay = now.getDate()         // 1-31

  // Filtra leads won com closed_at cujo mes+dia bate com hoje, e que fecharam ha pelo menos 2 anos.
  // Postgres extract devolve numerico — usamos rpc-like filter via raw filter ou client-side.
  // Para simplicidade: query alargada (won + closed_at not null) e filtramos em JS.
  const { data: candidates, error } = await svc
    .from('leads')
    .select('id, team_id, lead_type, assigned_to, closed_at, full_name')
    .eq('status', 'won')
    .not('closed_at', 'is', null)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const matches = (candidates ?? []).filter((l) => {
    if (!l.closed_at) return false
    const d = new Date(l.closed_at as string)
    return d.getMonth() + 1 === todayMonth && d.getDate() === todayDay && now.getFullYear() - d.getFullYear() >= 2
  })

  let createdCount = 0
  const titles: string[] = []
  for (const lead of matches) {
    const created = await applyAnniversaryTask(svc, {
      leadId: lead.id as string,
      teamId: lead.team_id as string,
      leadType: ((lead.lead_type as LeadType | null | undefined) ?? 'unknown') as LeadType,
      closedAt: lead.closed_at as string,
      assignedTo: (lead.assigned_to as string | null) ?? null,
    })
    if (created) {
      createdCount += 1
      titles.push(`${created} (${lead.full_name})`)
    }
  }

  return NextResponse.json({
    ok: true,
    candidates: matches.length,
    created: createdCount,
    titles,
  })
}
