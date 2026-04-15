import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const mergeSchema = z.object({
  primary_id: z.string().uuid(),
  secondary_id: z.string().uuid(),
  // Campos da secundária a copiar para a primária (apenas se null/vazio na primária)
  copy_fields: z.array(z.enum(['phone', 'email', 'source', 'notes', 'score', 'urgency'])).optional().default([]),
})

export const maxDuration = 30

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: member } = await supabase
    .from('team_members')
    .select('team_id, role')
    .eq('user_id', user.id)
    .single()

  if (!member) return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
  if (member.role !== 'admin') return NextResponse.json({ error: 'Apenas admins podem fazer merge' }, { status: 403 })

  const body = await request.json()
  const parsed = mergeSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Dados inválidos' }, { status: 400 })

  const { primary_id, secondary_id, copy_fields } = parsed.data

  if (primary_id === secondary_id) {
    return NextResponse.json({ error: 'Primária e secundária são a mesma lead' }, { status: 400 })
  }

  // Verificar que ambas pertencem ao mesmo team
  const { data: leads } = await supabase
    .from('leads')
    .select('id, team_id, phone, email, source, notes, score, urgency')
    .in('id', [primary_id, secondary_id])
    .eq('team_id', member.team_id)

  if (!leads || leads.length !== 2) {
    return NextResponse.json({ error: 'Uma ou ambas as leads não encontradas' }, { status: 404 })
  }

  const primary = leads.find(l => l.id === primary_id)!
  const secondary = leads.find(l => l.id === secondary_id)!

  const svc = createServiceClient()

  // Copiar campos da secundária para a primária (apenas se a primária tiver null/vazio)
  if (copy_fields.length > 0) {
    const updates: Record<string, unknown> = {}
    for (const field of copy_fields) {
      const primaryVal = primary[field as keyof typeof primary]
      const secondaryVal = secondary[field as keyof typeof secondary]
      if (!primaryVal && secondaryVal) {
        updates[field] = secondaryVal
      }
    }
    if (Object.keys(updates).length > 0) {
      await svc.from('leads').update(updates).eq('id', primary_id)
    }
  }

  // Mover interações, tarefas, call_uploads para a primária
  await svc.from('interactions').update({ lead_id: primary_id }).eq('lead_id', secondary_id)
  await svc.from('tasks').update({ lead_id: primary_id }).eq('lead_id', secondary_id)
  await svc.from('call_uploads').update({ lead_id: primary_id }).eq('lead_id', secondary_id)

  // lead_profiles: só mover se a primária não tiver profile próprio
  const { data: primaryProfile } = await svc
    .from('lead_profiles')
    .select('id')
    .eq('lead_id', primary_id)
    .maybeSingle()

  if (!primaryProfile) {
    await svc.from('lead_profiles').update({ lead_id: primary_id }).eq('lead_id', secondary_id)
  }
  // Se a primária já tem profile, o profile da secundária será apagado pelo CASCADE ao eliminar a secundária

  // Limpar ficheiros de áudio da secundária que não foram movidos (lead_id da call_uploads já foi alterado)
  // Apagar a lead secundária (CASCADE trata o que sobrou)
  const { error } = await svc.from('leads').delete().eq('id', secondary_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, primary_id })
}
