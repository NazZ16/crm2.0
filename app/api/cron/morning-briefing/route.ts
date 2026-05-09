// /api/cron/morning-briefing
// Vercel Cron: 7h UTC (~7-8h Lisboa). Junta tarefas + agenda Google + leads urgentes/frias
// e envia mensagem Telegram para os chat IDs autorizados.
//
// Tambem pode ser chamado manualmente para teste:
//   GET /api/cron/morning-briefing?secret=<CRON_SECRET>
//
// Vercel passa header `Authorization: Bearer <CRON_SECRET>` automaticamente
// se a env var CRON_SECRET estiver definida; aceitamos os dois mecanismos.

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { listTodaysEvents, type GoogleCalendarEvent } from '@/lib/google-calendar'
import { sendTelegramMessage, getAllowedChatIds, escapeHtml } from '@/lib/telegram'

export const maxDuration = 60

interface TaskRow {
  id: string
  title: string
  priority: string
  due_at: string | null
  lead_id: string | null
  full_name?: string | null
}

interface LeadRow {
  id: string
  full_name: string
  score: number
  urgency: number
  last_contact_at: string | null
  created_at: string
}

function isAuthorized(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return true // se nao configurado, deixa passar (so para dev)

  // Vercel cron header
  const authHeader = request.headers.get('authorization')
  if (authHeader === `Bearer ${cronSecret}`) return true

  // Manual test via query param
  const url = new URL(request.url)
  if (url.searchParams.get('secret') === cronSecret) return true

  return false
}

function fmtTime(ev: GoogleCalendarEvent): string {
  if (ev.start.dateTime) {
    return new Date(ev.start.dateTime).toLocaleTimeString('pt-PT', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Lisbon',
    })
  }
  if (ev.start.date) return 'dia inteiro'
  return ''
}

function priorityIcon(p: string): string {
  if (p === 'urgent') return '🚨'
  if (p === 'high') return '🔴'
  if (p === 'medium') return '🟡'
  return '⚪'
}

async function buildBriefing(teamId: string): Promise<{ html: string; isEmpty: boolean }> {
  const svc = createServiceClient()

  const now = new Date()
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0).toISOString()
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString()
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString()

  const [tasksRes, urgentRes, coldCountRes, eventsList] = await Promise.all([
    svc
      .from('tasks')
      .select('id, title, priority, due_at, lead_id, leads(full_name)')
      .eq('team_id', teamId)
      .eq('status', 'open')
      .lte('due_at', endOfDay)
      .order('due_at', { ascending: true })
      .limit(20),
    svc
      .from('leads')
      .select('id, full_name, score, urgency, last_contact_at, created_at')
      .eq('team_id', teamId)
      .not('status', 'in', '(won,lost)')
      .or('urgency.gte.4,score.gte.80')
      .order('urgency', { ascending: false })
      .limit(5),
    svc
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('team_id', teamId)
      .not('status', 'in', '(won,lost)')
      .lt('last_contact_at', fourteenDaysAgo),
    listTodaysEvents(teamId).catch(() => [] as GoogleCalendarEvent[]),
  ])

  const tasksRaw = (tasksRes.data ?? []) as Array<TaskRow & { leads?: { full_name?: string } | { full_name?: string }[] }>
  const tasks: TaskRow[] = tasksRaw.map((t) => {
    const leadObj = Array.isArray(t.leads) ? t.leads[0] : t.leads
    return {
      id: t.id,
      title: t.title,
      priority: t.priority,
      due_at: t.due_at,
      lead_id: t.lead_id,
      full_name: leadObj?.full_name ?? null,
    }
  })

  const urgent = (urgentRes.data ?? []) as LeadRow[]
  const coldCount = coldCountRes.count ?? 0
  const events = eventsList ?? []

  const overdue = tasks.filter((t) => t.due_at && new Date(t.due_at) < now)
  const dueToday = tasks.filter((t) => !overdue.includes(t))

  const isEmpty = events.length === 0 && tasks.length === 0 && urgent.length === 0 && coldCount === 0

  const dateStr = now.toLocaleDateString('pt-PT', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })

  const lines: string[] = []
  lines.push(`<b>🌅 Bom dia. Briefing de ${escapeHtml(dateStr)}.</b>`)
  lines.push('')

  if (isEmpty) {
    lines.push('Hoje sem agenda nem tarefas urgentes. Aproveita para angariar.')
    return { html: lines.join('\n'), isEmpty: false }
  }

  if (events.length > 0) {
    lines.push(`<b>📅 AGENDA HOJE</b> (${events.length})`)
    for (const ev of events.slice(0, 8)) {
      const time = fmtTime(ev)
      const title = escapeHtml(ev.summary ?? '(sem titulo)')
      const loc = ev.location ? ` — ${escapeHtml(ev.location)}` : ''
      lines.push(`• <b>${time}</b> ${title}${loc}`)
    }
    if (events.length > 8) lines.push(`<i>...mais ${events.length - 8}</i>`)
    lines.push('')
  }

  if (overdue.length > 0) {
    lines.push(`<b>⏰ ATRASADAS</b> (${overdue.length})`)
    for (const t of overdue.slice(0, 5)) {
      const lead = t.full_name ? ` — ${escapeHtml(t.full_name)}` : ''
      lines.push(`${priorityIcon(t.priority)} ${escapeHtml(t.title)}${lead}`)
    }
    if (overdue.length > 5) lines.push(`<i>...mais ${overdue.length - 5}</i>`)
    lines.push('')
  }

  if (dueToday.length > 0) {
    lines.push(`<b>✅ TAREFAS DE HOJE</b> (${dueToday.length})`)
    for (const t of dueToday.slice(0, 8)) {
      const lead = t.full_name ? ` — ${escapeHtml(t.full_name)}` : ''
      lines.push(`${priorityIcon(t.priority)} ${escapeHtml(t.title)}${lead}`)
    }
    if (dueToday.length > 8) lines.push(`<i>...mais ${dueToday.length - 8}</i>`)
    lines.push('')
  }

  if (urgent.length > 0) {
    lines.push(`<b>🔥 LEADS URGENTES</b> (${urgent.length})`)
    for (const l of urgent) {
      lines.push(`• ${escapeHtml(l.full_name)} — urg ${l.urgency}/5, score ${l.score}`)
    }
    lines.push('')
  }

  if (coldCount > 0) {
    lines.push(`<b>❄️ ${coldCount} lead${coldCount === 1 ? '' : 's'} sem contacto &gt; 14 dias</b>`)
    lines.push(`<i>Abre o dashboard para reactivar.</i>`)
    lines.push('')
  }

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? ''
  if (baseUrl) {
    lines.push(`<a href="${baseUrl}/dashboard">Abrir dashboard</a>`)
  }

  return { html: lines.join('\n'), isEmpty: false }
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })
  }

  const chatIds = getAllowedChatIds()
  if (chatIds.length === 0) {
    return NextResponse.json(
      { error: 'TELEGRAM_ALLOWED_CHAT_IDS nao configurado — sem destinatarios' },
      { status: 500 }
    )
  }

  // Para single-tenant: usa o team padrao do Telegram bot
  const defaultTeamId = process.env.TELEGRAM_DEFAULT_TEAM_ID
  if (!defaultTeamId) {
    return NextResponse.json(
      { error: 'TELEGRAM_DEFAULT_TEAM_ID nao configurado' },
      { status: 500 }
    )
  }

  try {
    const { html, isEmpty } = await buildBriefing(defaultTeamId)
    if (isEmpty) {
      // Sem nada para reportar — saimos sem enviar para nao spammar com mensagens vazias
      return NextResponse.json({ ok: true, sent: false, reason: 'empty' })
    }

    const results = await Promise.all(
      chatIds.map((id) => sendTelegramMessage(id, html, { parseMode: 'HTML' }))
    )
    const failed = results.filter((r) => !r.ok)
    return NextResponse.json({
      ok: failed.length === 0,
      sent: results.length - failed.length,
      failed: failed.length,
      details: failed.length > 0 ? failed : undefined,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'erro desconhecido'
    console.error('[morning-briefing] erro:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
