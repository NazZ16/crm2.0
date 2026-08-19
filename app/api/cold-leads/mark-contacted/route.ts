// /api/cold-leads/mark-contacted
// POST { lead_id, channel: 'whatsapp'|'email'|'call', summary } → cria interaction
// e dispara o auto-bump (new -> qualified) se aplicavel. Atalho usado pela pagina
// /dashboard/cold-leads quando o user clica "Ja contactei" depois de enviar.

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { cancelObsoleteAutoTasks } from '@/lib/auto-tasks'

const schema = z.object({
  lead_id: z.string().uuid(),
  channel: z.enum(['whatsapp', 'email', 'call']),
  summary: z.string().max(500).optional(),
})

const CONTACT_TYPES = new Set(['call', 'whatsapp', 'email', 'meeting'])

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })

  const { data: member } = await supabase
    .from('team_members')
    .select('team_id, role')
    .eq('user_id', user.id)
    .single()
  if (!member || member.role === 'viewer') {
    return NextResponse.json({ error: 'Sem permissao' }, { status: 403 })
  }

  const body = await request.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Dados invalidos' }, { status: 400 })
  }

  const { data: lead } = await supabase
    .from('leads')
    .select('id, status')
    .eq('id', parsed.data.lead_id)
    .eq('team_id', member.team_id)
    .single()

  if (!lead) return NextResponse.json({ error: 'Lead nao encontrada' }, { status: 404 })

  const occurredAt = new Date().toISOString()
  const summary = parsed.data.summary ?? `Mensagem de re-engagement enviada (${parsed.data.channel})`

  await supabase.from('interactions').insert({
    lead_id: lead.id,
    team_id: member.team_id,
    type: parsed.data.channel,
    summary,
    occurred_at: occurredAt,
  })

  // Auto-bump + last_contact_at via service client (igual ao endpoint /api/interactions)
  const svc = createServiceClient()
  const isFirstContact = lead.status === 'new' && CONTACT_TYPES.has(parsed.data.channel)
  await svc
    .from('leads')
    .update({
      last_contact_at: occurredAt,
      ...(isFirstContact ? { status: 'qualified' } : {}),
    })
    .eq('id', lead.id)
    .eq('team_id', member.team_id)

  // Contacto retomado: fecha a task de recontacto [auto:stale], se existir.
  await cancelObsoleteAutoTasks(svc, {
    leadId: lead.id,
    teamId: member.team_id,
    matches: (key) => key === 'stale',
  })

  return NextResponse.json({
    ok: true,
    auto_bumped: isFirstContact ? 'qualified' : null,
  })
}
