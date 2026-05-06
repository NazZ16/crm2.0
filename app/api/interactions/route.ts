import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

// Tipos de interaccao que contam como contacto real (e por isso bumpam new -> qualified).
// 'note' e 'audio' (raw upload pre-processamento) NAO contam.
const CONTACT_TYPES = new Set(['call', 'whatsapp', 'email', 'meeting'])

const createInteractionSchema = z.object({
  lead_id: z.string().uuid(),
  type: z.enum(['call', 'whatsapp', 'email', 'meeting', 'note', 'audio']),
  raw_text: z.string().max(50000).optional(),
  summary: z.string().max(2000).optional(),
  occurred_at: z.string().datetime().optional(),
})

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: member } = await supabase
    .from('team_members')
    .select('team_id')
    .eq('user_id', user.id)
    .single()

  if (!member) return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const leadId = searchParams.get('lead_id')

  let query = supabase
    .from('interactions')
    .select('*')
    .eq('team_id', member.team_id)
    .order('occurred_at', { ascending: false })

  if (leadId) query = query.eq('lead_id', leadId)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data)
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: member } = await supabase
    .from('team_members')
    .select('team_id, role')
    .eq('user_id', user.id)
    .single()

  if (!member || member.role === 'viewer') {
    return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
  }

  const body = await request.json()
  const parsed = createInteractionSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Dados inválidos', details: parsed.error.flatten() }, { status: 400 })
  }

  // Verify lead belongs to team and capture current status para decidir auto-bump
  const { data: lead } = await supabase
    .from('leads')
    .select('id, status')
    .eq('id', parsed.data.lead_id)
    .eq('team_id', member.team_id)
    .single()

  if (!lead) return NextResponse.json({ error: 'Lead não encontrada' }, { status: 404 })

  const { data, error } = await supabase
    .from('interactions')
    .insert({ ...parsed.data, team_id: member.team_id })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Atualizar last_contact_at e auto-bump de status quando primeiro contacto real.
  // Usa service client para nao depender de RLS (auth ja foi verificada acima).
  const svc = createServiceClient()
  const leadUpdate: Record<string, unknown> = { last_contact_at: data.occurred_at }

  const isFirstContact = lead.status === 'new' && CONTACT_TYPES.has(parsed.data.type)
  if (isFirstContact) {
    leadUpdate.status = 'qualified'
  }

  await svc
    .from('leads')
    .update(leadUpdate)
    .eq('id', parsed.data.lead_id)
    .eq('team_id', member.team_id)

  if (isFirstContact) {
    console.log(`[interactions] auto-bump lead ${parsed.data.lead_id} new -> qualified (interaction ${parsed.data.type})`)
  }

  return NextResponse.json({ ...data, _auto_bumped: isFirstContact ? 'qualified' : null }, { status: 201 })
}
