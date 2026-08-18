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
    // Pessoas distintas contactadas por dia: chamadas, WhatsApp e email, via interactions
    // (fonte única de historico de contacto — lead_id e sempre preenchido aqui)
    supabase
      .from('interactions')
      .select('lead_id, occurred_at')
      .eq('team_id', member.team_id)
      .in('type', ['call', 'whatsapp', 'email'])
      .gte('occurred_at', since.toISOString())
      .order('occurred_at', { ascending: true }),
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

  const prospecting: ProspectingRow[] = (rawProspecting ?? []).map((r) => ({
    occurred_at: r.occurred_at as string,
    person_key: r.lead_id as string,
  }))

  return <CallsHistoryClient calls={calls} prospecting={prospecting} />
}
