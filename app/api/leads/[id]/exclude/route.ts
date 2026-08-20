import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

async function getLeadAndVerify(leadId: string, userId: string) {
  const supabase = await createClient()
  const { data: member } = await supabase
    .from('team_members')
    .select('team_id, role')
    .eq('user_id', userId)
    .single()

  if (!member) return { member: null, lead: null }

  const { data: lead } = await supabase
    .from('leads')
    .select('id, team_id, phone')
    .eq('id', leadId)
    .eq('team_id', member.team_id)
    .single()

  return { member, lead }
}

// Marca o telefone da lead como excluido de futuras mensagens de WhatsApp —
// nao gera mais leads/interactions/notificacoes nem entra na analise semanal
// por IA (ver lib/whatsapp-ingest.ts). Nao apaga a lead nem o historico atual.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })

  const { member, lead } = await getLeadAndVerify(id, user.id)
  if (!member || !lead) return NextResponse.json({ error: 'Lead nao encontrada' }, { status: 404 })
  if (member.role === 'viewer') return NextResponse.json({ error: 'Sem permissao' }, { status: 403 })
  if (!lead.phone) return NextResponse.json({ error: 'Lead sem telefone associado' }, { status: 400 })

  const svc = createServiceClient()
  const { error } = await svc
    .from('excluded_contacts')
    .upsert(
      { team_id: member.team_id, phone: lead.phone, reason: 'Excluido a partir da lead' },
      { onConflict: 'team_id,phone', ignoreDuplicates: true }
    )

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ excluded: true })
}

// Reverte a exclusao — o numero volta a gerar leads/analises normalmente.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })

  const { member, lead } = await getLeadAndVerify(id, user.id)
  if (!member || !lead) return NextResponse.json({ error: 'Lead nao encontrada' }, { status: 404 })
  if (member.role === 'viewer') return NextResponse.json({ error: 'Sem permissao' }, { status: 403 })
  if (!lead.phone) return NextResponse.json({ error: 'Lead sem telefone associado' }, { status: 400 })

  const svc = createServiceClient()
  const { error } = await svc
    .from('excluded_contacts')
    .delete()
    .eq('team_id', member.team_id)
    .eq('phone', lead.phone)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ excluded: false })
}
