import { createClient } from '@/lib/supabase/server'
import { formatCurrency } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { AD_PLATFORM_LABELS, type AdPlatform } from '@/lib/types'
import { Megaphone, TrendingUp, Users, Target } from 'lucide-react'
import MarketingAnalysisButton from './MarketingAnalysisButton'
import NewCampaignButton from './NewCampaignButton'

export const dynamic = 'force-dynamic'

export default async function MarketingPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: member } = await supabase
    .from('team_members')
    .select('team_id')
    .eq('user_id', user.id)
    .single()

  if (!member) return null

  const [campaignsRes, metricsRes, leadsSourceRes] = await Promise.all([
    supabase
      .from('campaigns')
      .select('*')
      .eq('team_id', member.team_id)
      .order('created_at', { ascending: false }),
    supabase
      .from('campaign_metrics')
      .select('campaign_id, spend, impressions, clicks, leads_count, conversions, date')
      .eq('team_id', member.team_id)
      .gte('date', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]),
    supabase
      .from('leads')
      .select('source')
      .eq('team_id', member.team_id)
      .not('source', 'is', null),
  ])

  const campaigns = campaignsRes.data ?? []
  const metrics = metricsRes.data ?? []
  const leadsSource = leadsSourceRes.data ?? []

  // Aggregate metrics by campaign
  const metricsByCampaign = metrics.reduce((acc, m) => {
    if (!acc[m.campaign_id]) {
      acc[m.campaign_id] = { spend: 0, impressions: 0, clicks: 0, leads: 0, conversions: 0 }
    }
    acc[m.campaign_id].spend += m.spend
    acc[m.campaign_id].impressions += m.impressions
    acc[m.campaign_id].clicks += m.clicks
    acc[m.campaign_id].leads += m.leads_count
    acc[m.campaign_id].conversions += m.conversions
    return acc
  }, {} as Record<string, { spend: number; impressions: number; clicks: number; leads: number; conversions: number }>)

  // Global KPIs
  const totalSpend = Object.values(metricsByCampaign).reduce((s, m) => s + m.spend, 0)
  const totalLeads = Object.values(metricsByCampaign).reduce((s, m) => s + m.leads, 0)
  const avgCPL = totalLeads > 0 ? totalSpend / totalLeads : 0

  // Source distribution
  const sourceCount = leadsSource.reduce((acc, l) => {
    const src = l.source ?? 'other'
    acc[src] = (acc[src] ?? 0) + 1
    return acc
  }, {} as Record<string, number>)
  const sortedSources = Object.entries(sourceCount).sort((a, b) => b[1] - a[1])

  const platformColors: Record<string, string> = {
    meta: 'bg-blue-100 text-blue-700',
    google: 'bg-green-100 text-green-700',
    tiktok: 'bg-pink-100 text-pink-700',
    organic: 'bg-gray-100 text-gray-700',
    other: 'bg-yellow-100 text-yellow-700',
  }

  const statusColors: Record<string, string> = {
    active: 'bg-green-100 text-green-700',
    paused: 'bg-yellow-100 text-yellow-700',
    ended: 'bg-gray-100 text-gray-600',
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Marketing</h1>
          <p className="text-sm text-gray-500 mt-0.5">Performance das campanhas — últimos 30 dias</p>
        </div>
        <div className="flex items-center gap-2">
          <NewCampaignButton />
          <MarketingAnalysisButton />
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-red-50 rounded-lg">
                <TrendingUp size={18} className="text-red-600" />
              </div>
              <div>
                <div className="text-2xl font-bold">{formatCurrency(totalSpend)}</div>
                <div className="text-xs text-gray-500">Gasto total</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-50 rounded-lg">
                <Users size={18} className="text-blue-600" />
              </div>
              <div>
                <div className="text-2xl font-bold">{totalLeads}</div>
                <div className="text-xs text-gray-500">Leads geradas</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-50 rounded-lg">
                <Target size={18} className="text-green-600" />
              </div>
              <div>
                <div className="text-2xl font-bold">{formatCurrency(avgCPL)}</div>
                <div className="text-xs text-gray-500">CPL médio</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-50 rounded-lg">
                <Megaphone size={18} className="text-purple-600" />
              </div>
              <div>
                <div className="text-2xl font-bold">{campaigns.length}</div>
                <div className="text-xs text-gray-500">Campanhas ativas</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Campaigns Table */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Campanhas</CardTitle>
          </CardHeader>
          <CardContent>
            {campaigns.length === 0 ? (
              <div className="text-center py-8">
                <Megaphone size={40} className="mx-auto text-gray-200 mb-2" />
                <p className="text-sm text-gray-400">Sem campanhas registadas</p>
                <p className="text-xs text-gray-300 mt-1">
                  As campanhas serão sincronizadas automaticamente pelo N8N
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {campaigns.map((campaign) => {
                  const m = metricsByCampaign[campaign.id]
                  const cpl = m && m.leads > 0 ? m.spend / m.leads : null
                  return (
                    <div key={campaign.id} className="p-4 border border-gray-100 rounded-lg">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <p className="font-medium text-sm text-gray-800">{campaign.name}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge className={`text-xs ${platformColors[campaign.platform]}`}>
                              {AD_PLATFORM_LABELS[campaign.platform as AdPlatform]}
                            </Badge>
                            <Badge className={`text-xs ${statusColors[campaign.status]}`}>
                              {campaign.status === 'active' ? 'Ativa' : campaign.status === 'paused' ? 'Pausada' : 'Terminada'}
                            </Badge>
                          </div>
                        </div>
                        {cpl && (
                          <div className="text-right">
                            <div className="text-lg font-bold text-gray-700">{formatCurrency(cpl)}</div>
                            <div className="text-xs text-gray-400">CPL</div>
                          </div>
                        )}
                      </div>
                      {m && (
                        <div className="grid grid-cols-4 gap-2 text-center pt-2 border-t border-gray-100">
                          <div>
                            <div className="text-sm font-semibold">{formatCurrency(m.spend)}</div>
                            <div className="text-xs text-gray-400">Gasto</div>
                          </div>
                          <div>
                            <div className="text-sm font-semibold">{m.impressions.toLocaleString('pt-PT')}</div>
                            <div className="text-xs text-gray-400">Impressões</div>
                          </div>
                          <div>
                            <div className="text-sm font-semibold">{m.leads}</div>
                            <div className="text-xs text-gray-400">Leads</div>
                          </div>
                          <div>
                            <div className="text-sm font-semibold">{m.conversions}</div>
                            <div className="text-xs text-gray-400">Conversões</div>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Lead Sources */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Fontes de Leads</CardTitle>
          </CardHeader>
          <CardContent>
            {sortedSources.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">Sem dados</p>
            ) : (
              <div className="space-y-3">
                {sortedSources.map(([source, count]) => {
                  const total = leadsSource.length
                  const pct = Math.round((count / total) * 100)
                  return (
                    <div key={source}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm text-gray-700 capitalize">{source.replace('_', ' ')}</span>
                        <span className="text-sm font-semibold">{count} <span className="text-xs text-gray-400">({pct}%)</span></span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-1.5">
                        <div
                          className="bg-blue-500 h-1.5 rounded-full"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
