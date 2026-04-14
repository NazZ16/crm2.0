import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { CallsHistoryClient } from './CallsHistoryClient'

export const dynamic = 'force-dynamic'

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

  const { data: calls } = await supabase
    .from('call_uploads')
    .select(`
      id,
      duration_seconds,
      nota_script,
      script_analise,
      created_at,
      lead_id,
      leads(full_name)
    `)
    .eq('team_id', member.team_id)
    .not('nota_script', 'is', null)
    .order('created_at', { ascending: false })
    .limit(50)

  return <CallsHistoryClient calls={calls ?? []} />
}
