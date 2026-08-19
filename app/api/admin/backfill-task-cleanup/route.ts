// /api/admin/backfill-task-cleanup
// Endpoint de manutencao pontual (NAO e um cron agendado, nao esta no vercel.json).
// Aplica retroactivamente a limpeza de auto-tasks obsoletas (lib/auto-tasks.ts)
// a leads cujo status ja avancou ANTES desta funcionalidade existir — normalmente
// a limpeza so corre no momento da transicao de status. Corre-se uma vez a mao
// depois do deploy e pode ser chamado de novo sem risco (idempotente).
//
// Para leads actualmente frias, usa o cron existente /api/cron/stale-leads
// (ja inclui a mesma limpeza desde este patch).

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { cancelObsoleteAutoTasks, triggerStage } from '@/lib/auto-tasks'
import { LEAD_PIPELINE_ORDER, type LeadStatus } from '@/lib/types'

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
    const { data: leads, error } = await svc.from('leads').select('id, team_id, status').limit(5000)
    if (error) throw error

    const results: Array<{ leadId: string; cancelled: string[] }> = []
    for (const lead of leads ?? []) {
      const newStatusIndex = LEAD_PIPELINE_ORDER.indexOf(lead.status as LeadStatus)
      if (newStatusIndex === -1) continue

      const cancelled = await cancelObsoleteAutoTasks(svc, {
        leadId: lead.id,
        teamId: lead.team_id,
        matches: (key) => {
          const stage = triggerStage(key)
          if (!stage) return false
          const stageIndex = LEAD_PIPELINE_ORDER.indexOf(stage)
          return stageIndex !== -1 && stageIndex < newStatusIndex
        },
      })
      if (cancelled.length > 0) results.push({ leadId: lead.id, cancelled })
    }

    const totalCancelled = results.reduce((acc, r) => acc + r.cancelled.length, 0)
    return NextResponse.json({ ok: true, leadsAffected: results.length, totalCancelled, details: results })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'erro desconhecido'
    console.error('[backfill-task-cleanup] erro:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
