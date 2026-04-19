import { createClient } from '@/lib/supabase/server'
import { LEAD_STATUS_LABELS, LEAD_STATUS_COLORS, LEAD_PIPELINE_ORDER, type LeadStatus } from '@/lib/types'
import { formatRelativeTime } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import Link from 'next/link'
import { Plus, Search, ArrowRight, Phone, Mail, Bot, Mic } from 'lucide-react'
import { ImportLeadsButton } from './ImportLeadsButton'

export const dynamic = 'force-dynamic'

interface Props {
  searchParams: Promise<{ status?: string; q?: string }>
}

export default async function LeadsPage({ searchParams }: Props) {
  const { status, q } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: memberData } = await supabase
    .from('team_members')
    .select('team_id, role')
    .eq('user_id', user.id)
    .single()

  if (!memberData) return null

  let query = supabase
    .from('leads')
    .select(`
      id, full_name, phone, email, source, status, score, urgency,
      last_contact_at, created_at, assigned_to, campaign_id,
      lead_profiles(summary, confidence_score)
    `)
    .eq('team_id', memberData.team_id)
    .order('created_at', { ascending: false })

  if (status && LEAD_PIPELINE_ORDER.includes(status as LeadStatus)) {
    query = query.eq('status', status)
  }
  if (q) {
    query = query.ilike('full_name', `%${q}%`)
  }

  const { data: leads } = await query

  const activeStatus = status as LeadStatus | undefined

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Leads</h1>
          <p className="text-sm text-gray-500 mt-0.5">{leads?.length ?? 0} leads encontradas</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/dashboard/leads/upload-call">
            <Button variant="outline" className="gap-2">
              <Mic size={16} />
              Upload Chamada
            </Button>
          </Link>
          {memberData.role !== 'viewer' && <ImportLeadsButton />}
          <Link href="/dashboard/leads/new">
            <Button className="gap-2">
              <Plus size={16} />
              Nova Lead
            </Button>
          </Link>
        </div>
      </div>

      {/* Status filters */}
      <div className="flex gap-2 flex-wrap">
        <Link href="/dashboard/leads">
          <Badge
            variant={!activeStatus ? 'default' : 'outline'}
            className="cursor-pointer text-sm px-3 py-1"
          >
            Todas
          </Badge>
        </Link>
        {LEAD_PIPELINE_ORDER.map((s) => (
          <Link key={s} href={`/dashboard/leads?status=${s}`}>
            <Badge
              variant={activeStatus === s ? 'default' : 'outline'}
              className="cursor-pointer text-sm px-3 py-1"
            >
              {LEAD_STATUS_LABELS[s]}
            </Badge>
          </Link>
        ))}
      </div>

      {/* Leads Grid */}
      {!leads || leads.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-dashed border-gray-200">
          <p className="text-gray-400 mb-4">Nenhuma lead encontrada</p>
          <Link href="/dashboard/leads/new">
            <Button variant="outline" className="gap-2">
              <Plus size={16} />
              Adicionar primeira lead
            </Button>
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {leads.map((lead) => {
            const profile = Array.isArray(lead.lead_profiles) ? lead.lead_profiles[0] : lead.lead_profiles
            const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
            const lastContact = lead.last_contact_at ? new Date(lead.last_contact_at) : new Date(lead.created_at)
            const isCold = !['won', 'lost'].includes(lead.status) && lastContact < sevenDaysAgo

            return (
              <Link key={lead.id} href={`/dashboard/leads/${lead.id}`}>
                <Card className={`hover:shadow-md transition-shadow cursor-pointer ${isCold ? 'border-red-200' : ''}`}>
                  <CardContent className="pt-4 pb-4">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-sm font-bold text-blue-600 flex-shrink-0">
                          {lead.full_name[0]}
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-gray-900 truncate">{lead.full_name}</p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <Badge className={`text-xs ${LEAD_STATUS_COLORS[lead.status as LeadStatus]}`}>
                              {LEAD_STATUS_LABELS[lead.status as LeadStatus]}
                            </Badge>
                            {isCold && (
                              <Badge className="text-xs bg-red-100 text-red-600">Fria</Badge>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="text-lg font-bold text-gray-700">{lead.score}</div>
                        <div className="text-xs text-gray-400">score</div>
                      </div>
                    </div>

                    {profile?.summary && (
                      <p className="text-xs text-gray-500 mb-3 line-clamp-2">{profile.summary}</p>
                    )}

                    <div className="flex items-center gap-3 text-xs text-gray-400">
                      {lead.phone && (
                        <div className="flex items-center gap-1">
                          <Phone size={11} />
                          <span className="truncate max-w-[100px]">{lead.phone}</span>
                        </div>
                      )}
                      {lead.email && (
                        <div className="flex items-center gap-1">
                          <Mail size={11} />
                          <span className="truncate max-w-[100px]">{lead.email}</span>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
                      <div className="flex items-center gap-3 text-xs text-gray-400">
                        <span>Urgência: {lead.urgency}/5</span>
                        {lead.source && (
                          <span className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">
                            {lead.source}
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-gray-400">
                        {lead.last_contact_at
                          ? formatRelativeTime(lead.last_contact_at)
                          : formatRelativeTime(lead.created_at)}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
