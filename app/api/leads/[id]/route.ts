import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { applyAutoTaskOnStatusChange } from '@/lib/auto-tasks'
import { syncLeadToGoogleContact, deleteLeadGoogleContact } from '@/lib/lead-google-contact-sync'
import type { LeadStatus, LeadType } from '@/lib/types'

const updateLeadSchema = z.object({
  full_name: z.string().min(1).max(200).optional(),
  phone: z.string().max(30).nullable().optional(),
  email: z.string().email().nullable().optional(),
  source: z.string().max(100).nullable().optional(),
  status: z.enum(['new', 'qualified', 'meeting', 'active', 'cpcv', 'escriturado', 'won', 'lost']).optional(),
  lead_type: z.enum(['buyer', 'seller', 'both', 'unknown']).optional(),
  score: z.number().int().min(0).max(100).optional(),
  urgency: z.number().int().min(1).max(5).optional(),
  notes: z.string().max(2000).nullable().optional(),
  tags: z.array(z.string()).optional(),
  last_contact_at: z.string().datetime().nullable().optional(),
  next_action_at: z.string().datetime().nullable().optional(),
  assigned_to: z.string().uuid().nullable().optional(),
  campaign_id: z.string().uuid().nullable().optional(),
  // Tracking financeiro (migration 014)
  deal_value: z.number().nonnegative().nullable().optional(),
  commission_value: z.number().nonnegative().nullable().optional(),
  closed_at: z.string().datetime().nullable().optional(),
  // Sub-estados do fecho (migration 020)
  cpcv_date: z.string().datetime().nullable().optional(),
  escritura_date: z.string().datetime().nullable().optional(),
})

async function getLeadAndVerify(leadId: string, userId: string) {
  const supabase = await createClient()
  const { data: member } = await supabase
    .from('team_members')
    .select('team_id, role')
    .eq('user_id', userId)
    .single()

  if (!member) return { supabase, member: null, lead: null }

  // Captura status e lead_type actuais para detectar transicao no PATCH
  const { data: lead } = await supabase
    .from('leads')
    .select('id, team_id, status, lead_type, assigned_to, google_contact_resource_name')
    .eq('id', leadId)
    .eq('team_id', member.team_id)
    .single()

  return { supabase, member, lead }
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })

  const { data: member } = await supabase
    .from('team_members')
    .select('team_id')
    .eq('user_id', user.id)
    .single()

  if (!member) return NextResponse.json({ error: 'Sem permissao' }, { status: 403 })

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

  if (error) return NextResponse.json({ error: 'Lead nao encontrada' }, { status: 404 })

  return NextResponse.json(lead)
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })

  const { member, lead } = await getLeadAndVerify(id, user.id)
  if (!member || !lead) return NextResponse.json({ error: 'Lead nao encontrada' }, { status: 404 })
  if (member.role === 'viewer') return NextResponse.json({ error: 'Sem permissao' }, { status: 403 })

  const body = await request.json()
  const parsed = updateLeadSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Dados invalidos', details: parsed.error.flatten() }, { status: 400 })
  }

  // Auto-preencher datas quando se muda para os estados correspondentes, sem data explicita
  const updates: Record<string, unknown> = { ...parsed.data }
  if (updates.status === 'won' && !('closed_at' in updates)) {
    updates.closed_at = new Date().toISOString()
  }
  if (updates.status === 'cpcv' && !('cpcv_date' in updates)) {
    updates.cpcv_date = new Date().toISOString()
  }
  if (updates.status === 'escriturado' && !('escritura_date' in updates)) {
    updates.escritura_date = new Date().toISOString()
  }

  // Usa service client porque a posse ja foi verificada acima (member.team_id === lead.team_id).
  // Evita falsos sucessos por RLS quando a politica permite SELECT mas recusa UPDATE.
  const svc = createServiceClient()
  const { data, error } = await svc
    .from('leads')
    .update(updates)
    .eq('id', id)
    .eq('team_id', member.team_id) // defesa em profundidade
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Update nao afectou nenhuma linha' }, { status: 500 })

  // Auto-tasks on status change (best-effort, nao bloqueia a resposta).
  let autoTasksCreated: string[] = []
  if (
    typeof updates.status === 'string' &&
    lead.status &&
    lead.status !== updates.status
  ) {
    const oldStatus = lead.status as LeadStatus
    const newStatus = updates.status as LeadStatus
    const leadType = ((lead.lead_type as LeadType | null | undefined) ?? 'unknown') as LeadType
    // closed_at: prioriza o que vier no payload (acabou de ser preenchido), depois o ja gravado
    const effectiveClosedAt =
      (typeof updates.closed_at === 'string' ? (updates.closed_at as string) : null) ??
      ((data as { closed_at?: string | null }).closed_at ?? null)
    try {
      autoTasksCreated = await applyAutoTaskOnStatusChange(svc, {
        leadId: id,
        teamId: member.team_id,
        oldStatus,
        newStatus,
        leadType,
        assignedTo: (lead.assigned_to as string | null) ?? null,
        closedAt: effectiveClosedAt,
      })
    } catch (err) {
      console.warn('[lead PATCH] auto-task failed:', err)
    }
  }

  // Sync com Google Contacts (best-effort, nao bloqueia a resposta).
  try {
    await syncLeadToGoogleContact(member.team_id, data)
  } catch (err) {
    console.warn('[lead PATCH] google contact sync failed:', err)
  }

  return NextResponse.json({ ...data, _auto_tasks: autoTasksCreated })
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })

  const { member, lead } = await getLeadAndVerify(id, user.id)
  if (!member || !lead) return NextResponse.json({ error: 'Lead nao encontrada' }, { status: 404 })
  if (member.role !== 'admin') return NextResponse.json({ error: 'Apenas admins podem eliminar leads' }, { status: 403 })

  const svc = createServiceClient()

  const { data: uploads } = await svc
    .from('call_uploads')
    .select('storage_path')
    .eq('lead_id', id)

  if (uploads?.length) {
    await svc.storage.from('call-audio').remove(uploads.map((u) => u.storage_path))
  }

  if (lead.google_contact_resource_name) {
    try {
      await deleteLeadGoogleContact(member.team_id, lead.google_contact_resource_name as string)
    } catch (err) {
      console.warn('[lead DELETE] google contact delete failed:', err)
    }
  }

  const { error } = await svc.from('leads').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
