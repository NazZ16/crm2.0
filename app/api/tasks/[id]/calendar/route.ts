// /api/tasks/[id]/calendar
// POST   — adiciona task ao Google Calendar (cria evento e guarda google_event_id na task)
// DELETE — remove o evento Google e limpa google_event_id na task

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { createEvent, deleteEvent } from '@/lib/google-calendar'

const DEFAULT_DURATION_MINUTES = 30

async function authAndLoadTask(taskId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Nao autenticado' }, { status: 401 }) }

  const { data: member } = await supabase
    .from('team_members')
    .select('team_id, role')
    .eq('user_id', user.id)
    .single()
  if (!member || member.role === 'viewer') {
    return { error: NextResponse.json({ error: 'Sem permissao' }, { status: 403 }) }
  }

  const svc = createServiceClient()
  const { data: task } = await svc
    .from('tasks')
    .select('id, team_id, lead_id, title, description, due_at, google_event_id, leads(full_name)')
    .eq('id', taskId)
    .eq('team_id', member.team_id)
    .single()

  if (!task) return { error: NextResponse.json({ error: 'Task nao encontrada' }, { status: 404 }) }

  return { svc, member, task }
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await authAndLoadTask(id)
  if ('error' in auth) return auth.error
  const { svc, task } = auth

  if (!task.due_at) {
    return NextResponse.json({ error: 'Task sem prazo (due_at). Define um prazo antes de sincronizar.' }, { status: 400 })
  }
  if (task.google_event_id) {
    return NextResponse.json({ error: 'Task ja sincronizada com o Google Calendar.', event_id: task.google_event_id }, { status: 409 })
  }

  // Compoe o evento. Duracao 30min por defeito.
  const start = new Date(task.due_at as string)
  const end = new Date(start.getTime() + DEFAULT_DURATION_MINUTES * 60 * 1000)

  const leadName = (() => {
    const leads = task.leads as { full_name?: string } | { full_name?: string }[] | null
    if (!leads) return null
    return Array.isArray(leads) ? leads[0]?.full_name ?? null : leads.full_name ?? null
  })()

  const summary = leadName ? `${task.title} — ${leadName}` : (task.title as string)
  const description = [
    task.description ?? null,
    leadName ? `\n\nLead: ${leadName}` : null,
    process.env.NEXT_PUBLIC_SITE_URL && task.lead_id
      ? `${process.env.NEXT_PUBLIC_SITE_URL}/dashboard/leads/${task.lead_id}`
      : null,
  ]
    .filter(Boolean)
    .join('\n')

  try {
    const event = await createEvent(
      task.team_id as string,
      {
        summary,
        description,
        start: { dateTime: start.toISOString(), timeZone: 'Europe/Lisbon' },
        end: { dateTime: end.toISOString(), timeZone: 'Europe/Lisbon' },
      },
      task.id as string
    )

    if (!event) {
      return NextResponse.json(
        { error: 'Google Calendar nao ligado. Liga em /dashboard/settings.' },
        { status: 412 }
      )
    }

    await svc
      .from('tasks')
      .update({
        google_event_id: event.id,
        google_event_synced_at: new Date().toISOString(),
      })
      .eq('id', task.id)

    return NextResponse.json({ ok: true, event_id: event.id, htmlLink: event.htmlLink })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'erro desconhecido'
    // Se o erro mencionar "insufficient permission" ou "scope", e provavelmente scope antigo
    if (/insufficient.*permission|scope|forbidden/i.test(msg)) {
      return NextResponse.json(
        {
          error: 'Permissao Google insuficiente. Re-liga a conta em /dashboard/settings (precisamos de scope events.write).',
          needsReauth: true,
        },
        { status: 403 }
      )
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await authAndLoadTask(id)
  if ('error' in auth) return auth.error
  const { svc, task } = auth

  if (!task.google_event_id) {
    return NextResponse.json({ error: 'Task nao tem evento associado.' }, { status: 400 })
  }

  try {
    await deleteEvent(task.team_id as string, task.google_event_id as string)
    await svc
      .from('tasks')
      .update({ google_event_id: null, google_event_synced_at: null })
      .eq('id', task.id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'erro desconhecido'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
