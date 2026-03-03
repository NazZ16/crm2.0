import { createClient } from '@/lib/supabase/server'
import {
  INVESTOR_STATUS_LABELS, INVESTMENT_TYPE_LABELS,
  type InvestorStatus, type Investor,
} from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import Link from 'next/link'
import { Plus, MapPin, TrendingUp, Wallet, Building2 } from 'lucide-react'
import { formatEur } from '@/lib/roi-calculator'

export const dynamic = 'force-dynamic'

const STATUS_COLORS: Record<InvestorStatus, string> = {
  active: 'bg-green-100 text-green-800',
  inactive: 'bg-gray-100 text-gray-600',
  invested: 'bg-blue-100 text-blue-800',
}

interface Props {
  searchParams: Promise<{ status?: string }>
}

export default async function InvestorsPage({ searchParams }: Props) {
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
    .from('investors')
    .select('*')
    .eq('team_id', member.team_id)
    .order('created_at', { ascending: false })

  if (status) query = query.eq('status', status)

  const { data: investors } = await query

  // Contar matches por investidor
  const { data: matchCounts } = await supabase
    .from('investor_matches')
    .select('investor_id')
    .eq('team_id', member.team_id)

  const matchMap: Record<string, number> = {}
  matchCounts?.forEach(({ investor_id }) => {
    matchMap[investor_id] = (matchMap[investor_id] ?? 0) + 1
  })

  const activeStatus = status as InvestorStatus | undefined
  const statuses: InvestorStatus[] = ['active', 'inactive', 'invested']

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Investidores</h1>
          <p className="text-sm text-gray-500 mt-0.5">{investors?.length ?? 0} investidores</p>
        </div>
        <Link href="/dashboard/investors/new">
          <Button className="gap-2 cursor-pointer">
            <Plus size={16} />
            Novo Investidor
          </Button>
        </Link>
      </div>

      {/* Filtros */}
      <div className="flex gap-2 flex-wrap">
        <Link href="/dashboard/investors">
          <Badge variant={!activeStatus ? 'default' : 'outline'} className="cursor-pointer text-sm px-3 py-1">
            Todos
          </Badge>
        </Link>
        {statuses.map((s) => (
          <Link key={s} href={`/dashboard/investors?status=${s}`}>
            <Badge variant={activeStatus === s ? 'default' : 'outline'} className="cursor-pointer text-sm px-3 py-1">
              {INVESTOR_STATUS_LABELS[s]}
            </Badge>
          </Link>
        ))}
      </div>

      {/* Grid */}
      {!investors?.length ? (
        <div className="text-center py-20 text-gray-400">
          <Building2 size={40} className="mx-auto mb-3 text-gray-300" />
          <p className="text-lg font-medium">Sem investidores ainda</p>
          <p className="text-sm mt-1 text-gray-500">Adiciona o primeiro investidor para começar a fazer match</p>
          <Link href="/dashboard/investors/new">
            <Button className="mt-4 gap-2 cursor-pointer">
              <Plus size={16} />
              Novo Investidor
            </Button>
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {(investors as Investor[]).map((inv) => (
            <Link
              key={inv.id}
              href={`/dashboard/investors/${inv.id}`}
              className="block cursor-pointer group"
            >
              <Card className="h-full hover:shadow-md transition-shadow group-hover:border-gray-300">
                <CardContent className="p-4 space-y-3">
                  {/* Nome + status */}
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold text-gray-900">{inv.name}</h3>
                      {inv.phone && <p className="text-sm text-gray-500">{inv.phone}</p>}
                    </div>
                    <Badge className={STATUS_COLORS[inv.status]}>
                      {INVESTOR_STATUS_LABELS[inv.status]}
                    </Badge>
                  </div>

                  {/* Orçamento */}
                  {(inv.budget_min || inv.budget_max) && (
                    <div className="flex items-center gap-1.5 text-sm text-gray-700">
                      <Wallet size={14} className="text-gray-400" />
                      <span>
                        {inv.budget_min ? formatEur(inv.budget_min) : '?'}
                        {' – '}
                        {inv.budget_max ? formatEur(inv.budget_max) : '?'}
                      </span>
                    </div>
                  )}

                  {/* Yield mínimo */}
                  {inv.min_yield && (
                    <div className="flex items-center gap-1.5 text-sm text-gray-700">
                      <TrendingUp size={14} className="text-gray-400" />
                      <span>Yield mín: <strong>{inv.min_yield}%</strong></span>
                    </div>
                  )}

                  {/* Zonas */}
                  {inv.preferred_zones.length > 0 && (
                    <div className="flex items-start gap-1.5 text-sm text-gray-700">
                      <MapPin size={14} className="text-gray-400 mt-0.5 flex-shrink-0" />
                      <span className="line-clamp-1">{inv.preferred_zones.join(', ')}</span>
                    </div>
                  )}

                  {/* Tipos de investimento */}
                  {inv.investment_type.length > 0 && (
                    <div className="flex gap-1 flex-wrap">
                      {inv.investment_type.map((t) => (
                        <Badge key={t} variant="outline" className="text-xs">
                          {INVESTMENT_TYPE_LABELS[t as keyof typeof INVESTMENT_TYPE_LABELS]}
                        </Badge>
                      ))}
                    </div>
                  )}

                  {/* Matches */}
                  <div className="pt-1 border-t border-gray-100">
                    <span className="text-xs text-gray-500">
                      {matchMap[inv.id] ?? 0} oportunidades em análise
                    </span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
