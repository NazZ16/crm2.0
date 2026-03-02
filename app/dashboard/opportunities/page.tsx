import { createClient } from '@/lib/supabase/server'
import {
  OPPORTUNITY_STATUS_LABELS, PROPERTY_TYPE_LABELS,
  type OpportunityStatus, type Opportunity,
} from '@/lib/types'
import { calcularRoi, formatEur, formatPct } from '@/lib/roi-calculator'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import Link from 'next/link'
import { Plus, MapPin, TrendingUp, ArrowRight, Home } from 'lucide-react'

export const dynamic = 'force-dynamic'

const STATUS_COLORS: Record<OpportunityStatus, string> = {
  analyzing: 'bg-yellow-100 text-yellow-800',
  available: 'bg-green-100 text-green-800',
  under_offer: 'bg-blue-100 text-blue-800',
  closed: 'bg-gray-100 text-gray-700',
  passed: 'bg-red-100 text-red-700',
}

interface Props {
  searchParams: Promise<{ status?: string }>
}

export default async function OpportunitiesPage({ searchParams }: Props) {
  const { status } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: member } = await supabase
    .from('team_members')
    .select('team_id')
    .eq('user_id', user.id)
    .single()

  if (!member) return null

  let query = supabase
    .from('opportunities')
    .select('*')
    .eq('team_id', member.team_id)
    .order('created_at', { ascending: false })

  if (status) query = query.eq('status', status)

  const { data: opportunities } = await query

  const allStatuses: OpportunityStatus[] = ['analyzing', 'available', 'under_offer', 'closed', 'passed']
  const activeStatus = status as OpportunityStatus | undefined

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Oportunidades</h1>
          <p className="text-sm text-gray-500 mt-0.5">{opportunities?.length ?? 0} oportunidades de investimento</p>
        </div>
        <Link href="/dashboard/opportunities/new">
          <Button className="gap-2">
            <Plus size={16} />
            Nova Oportunidade
          </Button>
        </Link>
      </div>

      {/* Filtros */}
      <div className="flex gap-2 flex-wrap">
        <Link href="/dashboard/opportunities">
          <Badge variant={!activeStatus ? 'default' : 'outline'} className="cursor-pointer text-sm px-3 py-1">
            Todas
          </Badge>
        </Link>
        {allStatuses.map((s) => (
          <Link key={s} href={`/dashboard/opportunities?status=${s}`}>
            <Badge variant={activeStatus === s ? 'default' : 'outline'} className="cursor-pointer text-sm px-3 py-1">
              {OPPORTUNITY_STATUS_LABELS[s]}
            </Badge>
          </Link>
        ))}
      </div>

      {/* Grid */}
      {!opportunities?.length ? (
        <div className="text-center py-20 text-gray-400">
          <Home size={40} className="mx-auto mb-3 text-gray-300" />
          <p className="text-lg font-medium">Sem oportunidades ainda</p>
          <p className="text-sm mt-1">Adiciona a primeira oportunidade para começar a análise de ROI</p>
          <Link href="/dashboard/opportunities/new">
            <Button className="mt-4 gap-2">
              <Plus size={16} />
              Nova Oportunidade
            </Button>
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {(opportunities as Opportunity[]).map((opp) => {
            const roi = calcularRoi(opp)
            const preco = opp.negotiated_price ?? opp.asking_price

            return (
              <Card key={opp.id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-4 space-y-3">
                  {/* Título + status */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-gray-900 truncate">{opp.title}</h3>
                      <div className="flex items-center gap-1 text-sm text-gray-500 mt-0.5">
                        <MapPin size={12} />
                        <span>{opp.zone}{opp.typology ? ` · ${opp.typology}` : ''}</span>
                      </div>
                    </div>
                    <Badge className={STATUS_COLORS[opp.status]}>
                      {OPPORTUNITY_STATUS_LABELS[opp.status]}
                    </Badge>
                  </div>

                  {/* Preço */}
                  <div>
                    <p className="text-xl font-bold text-gray-900">{formatEur(preco)}</p>
                    {opp.negotiated_price && opp.negotiated_price < opp.asking_price && (
                      <p className="text-xs text-gray-400 line-through">{formatEur(opp.asking_price)} pedido</p>
                    )}
                    <p className="text-xs text-gray-500">{PROPERTY_TYPE_LABELS[opp.property_type]}</p>
                  </div>

                  {/* ROI métricas */}
                  {roi.yield_bruto > 0 && (
                    <div className="grid grid-cols-2 gap-2 bg-gray-50 rounded-lg p-2.5">
                      <div>
                        <p className="text-xs text-gray-400">Yield Bruto</p>
                        <p className="font-bold text-green-700 text-sm flex items-center gap-1">
                          <TrendingUp size={12} />
                          {formatPct(roi.yield_bruto)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-400">Yield Líquido</p>
                        <p className="font-bold text-gray-700 text-sm">{formatPct(roi.yield_liquido)}</p>
                      </div>
                      {roi.payback_anos && (
                        <div>
                          <p className="text-xs text-gray-400">Payback</p>
                          <p className="font-medium text-gray-700 text-sm">{roi.payback_anos} anos</p>
                        </div>
                      )}
                      {opp.estimated_monthly_rent && (
                        <div>
                          <p className="text-xs text-gray-400">Renda/mês</p>
                          <p className="font-medium text-gray-700 text-sm">{formatEur(opp.estimated_monthly_rent)}</p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Footer */}
                  <div className="flex items-center justify-between pt-1 border-t border-gray-100">
                    {opp.source && (
                      <span className="text-xs text-gray-400">{opp.source}</span>
                    )}
                    <Link href={`/dashboard/opportunities/${opp.id}`} className="ml-auto">
                      <Button variant="ghost" size="sm" className="gap-1 text-blue-600 h-7 px-2">
                        Ver detalhe <ArrowRight size={12} />
                      </Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
