import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { CallsHistoryClient, type CallRow, type ProspectingRow } from './CallsHistoryClient'

export const dynamic = 'force-dynamic'

const PROSPECTING_WINDOW_DAYS = 14

export default async function CallsHistoryPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: member } = await supabase
    .from('team_members')
    .select('team_id')
    .eq('user_id', user.id)
    .single()

  if (!member) redirect('/login')

  const since = new Date()
  since.setDate(since.getDate() - (PROSPECTING_WINDOW_DAYS - 1))
  since.setHours(0, 0, 0, 0)

  const [{ data: rawCalls }, { data: rawProspecting }] = await Promise.all([
    supabase
      .from('call_uploads')
      .select(`
        id,
        audio_duration_s,
        coach_feedback,
        transcript_formatted,
        transcript_text,
        created_at,
        status,
        lead_id,
        leads(id, full_name, phone)
      `)
      .eq('team_id', member.team_id)
      .eq('status', 'done')
      .order('created_at', { ascending: false })
      .limit(50),
    // Janela dedicada (sem o limite de 50) para contar pessoas distintas contactadas por dia
    supabase
      .from('call_uploads')
      .select('id, lead_id, created_at, leads(phone)')
      .eq('team_id', member.team_id)
      .eq('status', 'done')
      .gte('created_at', since.toISOString())
      .order('created_at', { ascending: true }),
  ])

  type LeadJoin = { id: string; full_name: string; phone: string | null } | null
  const calls: CallRow[] = (rawCalls ?? []).map((c) => {
    const leadObj = (Array.isArray(c.leads) ? c.leads[0] : c.leads) as LeadJoin
    return {
      id: c.id,
      audio_duration_s: c.audio_duration_s as number | null,
      coach_feedback: c.coach_feedback as Record<string, unknown> | null,
      transcript_formatted: (c.transcript_formatted as string | null) ?? null,
      transcript_text: (c.transcript_text as string | null) ?? null,
      created_at: c.created_at as string,
      lead_id: leadObj?.id ?? null,
      lead_name: leadObj?.full_name ?? 'Lead sem nome',
      lead_phone: leadObj?.phone ?? null,
    }
  })

  type ProspLeadJoin = { phone: string | null } | null
  const prospecting: ProspectingRow[] = (rawProspecting ?? []).map((r) => {
    const leadObj = (Array.isArray(r.leads) ? r.leads[0] : r.leads) as ProspLeadJoin
    // Identifica a "pessoa" pelo lead, depois pelo telefone; sem nenhum dos dois, a chamada conta como pessoa própria
    const personKey = (r.lead_id as string | null) ?? leadObj?.phone ?? `call:${r.id}`
    return {
      created_at: r.created_at as string,
      person_key: personKey,
    }
  })

  return <CallsHistoryClient calls={calls} prospecting={prospecting} />
}
