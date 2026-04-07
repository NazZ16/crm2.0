import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const updateLeadSchema = z.object({
  full_name: z.string().min(1).max(200).optional(),
  phone: z.string().max(30).nullable().optional(),
  email: z.string().email().nullable().optional(),
  source: z.string().max(100).nullable().optional(),
  status: z.enum(['new', 'qualified', 'meeting', 'active', 'won', 'lost']).optional(),
  score: z.number().int().min(0).max(100).optional(),
  urgency: z.number().int().min(1).max(5).optional(),
  notes: z.string().max(2000).nullable().optional(),
  tags: z.array(z.string()).optional(),
  last_contact_at: z.string().datetime().nullable().optional(),
  next_action_at: z.string().datetime().nullable().optional(),
  assigned_to: z.string().uuid().nullable().optional(),
  campaign_id: z.string().uuid().nullable().optional(),
})

async function getLeadAndVerify(leadId: string, userId: string) {
  const supabase = await createClient()
  const { data: member } = await supabase
    .from('team_members')
    .select('team_id, role')
    .eq('user_id', userId)
    .single()

  if (!member) return { supabase, member: null, lead: null }

  const { data: lead } = await supabase
    .from('leads')
    .select('id, team_id')
    .eq('id', leadId)
    .eq('team_id', member.team_id)
    .single()

  return { supabase, member, lead }
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: member } = await supabase
    .from('team_members')
    .select('team_id')
    .eq('user_id', user.id)
    .single()

  if (!member) return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })

  const { data: lead, error } = await supabase
    .from('leads')
    .select(`
      *,
      lead_profiles(*),
      interactions(id, type, summary, occurred_at, created_at),
      tasks(id, title, status, priority, due_at, created_by, assigned_to)
    `)
    .eq('id', id)
    .eq('team_id', member.team_id)
    .order('occurred_at', { foreignTable: 'interactions', ascending: false })
    .single()

  if (error) return NextResponse.json({ error: 'Lead não encontrada' }, { status: 404 })

  return NextResponse.json(lead)
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { member, lead } = await getLeadAndVerify(id, user.id)
  if (!member || !lead) return NextResponse.json({ error: 'Lead não encontrada' }, { status: 404 })
  if (member.role === 'viewer') return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })

  const body = await request.json()
  const parsed = updateLeadSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Dados inválidos', details: parsed.error.flatten() }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('leads')
    .update(parsed.data)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data)
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { member, lead } = await getLeadAndVerify(id, user.id)
  if (!member || !lead) return NextResponse.json({ error: 'Lead não encontrada' }, { status: 404 })
  if (member.role !== 'admin') return NextResponse.json({ error: 'Apenas admins podem eliminar leads' }, { status: 403 })

  // Cascata manual com service client
  const svc = createServiceClient()

  // Obter paths de áudio antes de apagar os registos
  const { data: uploads } = await svc
    .from('call_uploads')
    .select('storage_path')
    .eq('lead_id', id)

  await svc.from('interactions').delete().eq('lead_id', id)
  await svc.from('tasks').delete().eq('lead_id', id)
  await svc.from('lead_profiles').delete().eq('lead_id', id)
  await svc.from('agent_extractions').delete().eq('lead_id', id)
  await svc.from('call_uploads').delete().eq('lead_id', id)

  // Limpar ficheiros de áudio do storage
  if (uploads?.length) {
    await svc.storage.from('call-audio').remove(uploads.map((u) => u.storage_path))
  }

  const { error } = await svc.from('leads').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
