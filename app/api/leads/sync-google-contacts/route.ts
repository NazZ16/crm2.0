// /api/leads/sync-google-contacts
// Backfill: sincroniza com o Google Contacts as leads que ja existiam antes
// desta feature (tem telefone mas ainda nao foram sincronizadas).

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { syncLeadToGoogleContact } from '@/lib/lead-google-contact-sync'
import { buildContactPhoneIndex } from '@/lib/google-contacts'
import type { Lead } from '@/lib/types'

export async function POST() {
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

  const svc = createServiceClient()
  const { data: leads, error } = await svc
    .from('leads')
    .select('id, full_name, phone, email, status, lead_type, tags, notes, google_contact_resource_name')
    .eq('team_id', member.team_id)
    .not('phone', 'is', null)
    .is('google_contact_resource_name', null)
    .limit(500)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Constroi o indice telefone -> contacto Google UMA vez para o lote
  // inteiro (nao por lead) — evita esgotar a quota de leituras da People API.
  const phoneIndex = await buildContactPhoneIndex(member.team_id).catch(() => null)

  let synced = 0
  let failed = 0
  let firstError: string | null = null
  for (const lead of (leads ?? []) as Pick<Lead, 'id' | 'full_name' | 'phone' | 'email' | 'status' | 'lead_type' | 'tags' | 'notes'>[]) {
    try {
      await syncLeadToGoogleContact(member.team_id, lead, phoneIndex)
      synced++
    } catch (err) {
      failed++
      const msg = err instanceof Error ? err.message : String(err)
      if (!firstError) firstError = msg
      console.warn('[sync-google-contacts] falhou para lead', lead.id, err)
    }
  }

  return NextResponse.json({ total: leads?.length ?? 0, synced, failed, firstError })
}
