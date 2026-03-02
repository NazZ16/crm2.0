import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { LEAD_STATUS_LABELS, LEAD_PIPELINE_ORDER, type LeadStatus } from '@/lib/types'
import { BarChart3 } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function AnalyticsPage() {
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
    .select('status, score, urgency, source, created_at')
    .eq('team_id', member.team_id)

  const allLeads = leads ?? []
  const total = allLeads.length
  const won = allLeads.filter((l) => l.status === 'won').length
  const lost = allLeads.filter((l) => l.status === 'lost').length
  const active = allLeads.filter((l) => !['won', 'lost'].includes(l.status)).length
  const convRate = total > 0 ? ((won / total) * 100).toFixed(1) : '0'
  const avgScore = total > 0
    ? Math.round(allLeads.reduce((s, l) => s + l.score, 0) / total)
    : 0

  const byStatus = LEAD_PIPELINE_ORDER.reduce((acc, s) => {
    acc[s] = allLeads.filter((l) => l.status === s).length
    return acc
  }, {} as Record<LeadStatus, number>)

  const maxCount = Math.max(...Object.values(byStatus), 1)

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>
        <p className="text-sm text-gray-500 mt-0.5">KPIs e métricas de performance</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Leads', value: total, color: 'text-blue-700' },
          { label: 'Leads Ativas', value: active, color: 'text-green-700' },
          { label: 'Ganhos', value: won, color: 'text-emerald-700' },
          { label: 'Taxa Conversão', value: `${convRate}%`, color: 'text-purple-700' },
        ].map((kpi) => (
          <Card key={kpi.label}>
            <CardContent className="pt-5 text-center">
              <div className={`text-3xl font-bold ${kpi.color}`}>{kpi.value}</div>
              <div className="text-xs text-gray-500 mt-1">{kpi.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 size={16} />
              Leads por Etapa do Funil
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {LEAD_PIPELINE_ORDER.map((status) => {
                const count = byStatus[status]
                const pct = Math.round((count / maxCount) * 100)
                const colors: Record<LeadStatus, string> = {
                  new: 'bg-blue-500',
                  qualified: 'bg-purple-500',
                  meeting: 'bg-yellow-500',
                  active: 'bg-green-500',
                  won: 'bg-emerald-500',
                  lost: 'bg-red-400',
                }
                return (
                  <div key={status}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm text-gray-700">{LEAD_STATUS_LABELS[status]}</span>
                      <span className="text-sm font-bold">{count}</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-2">
                      <div
                        className={`${colors[status]} h-2 rounded-full transition-all`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Métricas de Qualidade</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
              <span className="text-sm text-gray-600">Score médio das leads</span>
              <span className="text-lg font-bold text-blue-700">{avgScore}/100</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
              <span className="text-sm text-gray-600">Leads perdidas</span>
              <span className="text-lg font-bold text-red-600">{lost}</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
              <span className="text-sm text-gray-600">Taxa de conversão</span>
              <span className="text-lg font-bold text-emerald-600">{convRate}%</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-blue-50 rounded-lg">
              <span className="text-sm text-gray-600">Pipeline ativo</span>
              <span className="text-lg font-bold text-blue-700">{active} leads</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
