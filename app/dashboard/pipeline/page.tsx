import { createClient } from '@/lib/supabase/server'
import { LEAD_STATUS_LABELS, LEAD_STATUS_COLORS, LEAD_PIPELINE_ORDER, type LeadStatus } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { formatRelativeTime } from '@/lib/utils'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function PipelinePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: member } = await supabase
    .from('team_members')
    .select('team_id')
    .eq('user_id', user.id)
    .single()

  if (!member) return null

  const { data: leads } = await supabase
    .from('leads')
    .select('id, full_name, status, score, urgency, last_contact_at, created_at, source, lead_profiles(summary)')
    .eq('team_id', member.team_id)
    .not('status', 'in', '("won","lost")')
    .order('score', { ascending: false })

  const allLeads = leads ?? []

  const byStatus = LEAD_PIPELINE_ORDER.filter((s) => !['won', 'lost'].includes(s)).reduce((acc, status) => {
    acc[status] = allLeads.filter((l) => l.status === status)
    return acc
  }, {} as Record<string, typeof allLeads>)

  return (
    <div className="p-6 max-w-full overflow-x-auto">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900">Pipeline Kanban</h1>
        <p className="text-sm text-gray-500 mt-0.5">{allLeads.length} leads ativas</p>
      </div>

      <div className="flex gap-4 min-w-max">
        {(['new', 'qualified', 'meeting', 'active'] as LeadStatus[]).map((status) => {
          const statusLeads = byStatus[status] ?? []
          return (
            <div key={status} className="w-72 flex-shrink-0">
              <div className="flex items-center gap-2 mb-3">
                <span className="font-semibold text-sm text-gray-700">{LEAD_STATUS_LABELS[status]}</span>
                <Badge variant="outline" className="text-xs">{statusLeads.length}</Badge>
              </div>
              <div className="space-y-3">
                {statusLeads.map((lead) => {
                  const profile = Array.isArray(lead.lead_profiles) ? lead.lead_profiles[0] : lead.lead_profiles
                  return (
                    <Link key={lead.id} href={`/dashboard/leads/${lead.id}`}>
                      <div className="bg-white border border-gray-200 rounded-lg p-3 hover:shadow-md transition-shadow cursor-pointer">
                        <div className="flex items-center gap-2 mb-2">
                          <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center text-xs font-bold text-blue-600 flex-shrink-0">
                            {lead.full_name[0]}
                          </div>
                          <span className="font-medium text-sm text-gray-800 truncate">{lead.full_name}</span>
                        </div>
                        {profile?.summary && (
                          <p className="text-xs text-gray-500 line-clamp-2 mb-2">{profile.summary}</p>
                        )}
                        <div className="flex items-center justify-between text-xs text-gray-400">
                          <span>Score: <strong className="text-gray-600">{lead.score}</strong></span>
                          <span>{formatRelativeTime(lead.last_contact_at ?? lead.created_at)}</span>
                        </div>
                        {lead.urgency >= 4 && (
                          <div className="mt-2">
                            <Badge className="text-xs bg-red-100 text-red-600">🔥 Urgente</Badge>
                          </div>
                        )}
                      </div>
                    </Link>
                  )
                })}
                {statusLeads.length === 0 && (
                  <div className="text-center py-6 border-2 border-dashed border-gray-200 rounded-lg">
                    <p className="text-xs text-gray-400">Sem leads</p>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
