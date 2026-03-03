import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import {
  INVESTOR_STATUS_LABELS, INVESTMENT_TYPE_LABELS, RISK_LEVEL_LABELS,
  INVESTMENT_HORIZON_LABELS, MAX_RENOVATION_LABELS, MATCH_STATUS_LABELS,
  OPPORTUNITY_STATUS_LABELS,
  type Investor, type InvestorMatch,
} from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ArrowLeft, Phone, Mail, MapPin, TrendingUp, Wallet, AlertCircle, CheckCircle2 } from 'lucide-react'
import { formatEur } from '@/lib/roi-calculator'
import { InvestorActions } from './InvestorActions'

export const dynamic = 'force-dynamic'

const MATCH_STATUS_COLORS: Record<string, string> = {
  suggested: 'bg-gray-100 text-gray-700',
  presented: 'bg-blue-100 text-blue-800',
  interested: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-700',
  invested: 'bg-emerald-100 text-emerald-800',
}

interface Props {
  params: Promise<{ id: string }>
}

export default async function InvestorDetailPage({ params }: Props) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: member } = await supabase
    .from('team_members')
    .select('team_id')
    .eq('user_id', user.id)
    .single()

  if (!member) return null

  const { data: investor } = await supabase
    .from('investors')
    .select('*')
    .eq('id', id)
    .eq('team_id', member.team_id)
    .single()

  if (!investor) notFound()

  const { data: matches } = await supabase
    .from('investor_matches')
    .select('*, opportunities(id, title, zone, typology, asking_price, negotiated_price, status)')
    .eq('investor_id', id)
    .eq('team_id', member.team_id)
    .order('match_score', { ascending: false })

  const inv = investor as Investor
  const matchList = (matches ?? []) as InvestorMatch[]

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5">
      {/* Breadcrumb */}
      <Link href="/dashboard/investors" className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1">
        <ArrowLeft size={14} />
        Voltar aos investidores
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{inv.name}</h1>
          <div className="flex items-center gap-3 mt-1">
            <Badge className="bg-green-100 text-green-800">
              {INVESTOR_STATUS_LABELS[inv.status]}
            </Badge>
            {inv.phone && (
              <span className="flex items-center gap-1 text-sm text-gray-500">
                <Phone size={12} /> {inv.phone}
              </span>
            )}
            {inv.email && (
              <span className="flex items-center gap-1 text-sm text-gray-500">
                <Mail size={12} /> {inv.email}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <InvestorActions id={id} />
          <Link href="/dashboard/opportunities">
            <Button size="sm" className="gap-2">Ver Oportunidades</Button>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Perfil */}
        <div className="lg:col-span-1 space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-sm text-gray-500 uppercase tracking-wide">Perfil de Investimento</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              {/* Orçamento */}
              {(inv.budget_min || inv.budget_max) && (
                <div className="flex items-start gap-2">
                  <Wallet size={14} className="text-gray-400 mt-0.5" />
                  <div>
                    <p className="text-gray-500 text-xs">Orçamento</p>
                    <p className="font-medium">
                      {inv.budget_min ? formatEur(inv.budget_min) : '?'}
                      {' – '}
                      {inv.budget_max ? formatEur(inv.budget_max) : '?'}
                    </p>
                  </div>
                </div>
              )}

              {/* Yield mínimo */}
              {inv.min_yield && (
                <div className="flex items-start gap-2">
                  <TrendingUp size={14} className="text-gray-400 mt-0.5" />
                  <div>
                    <p className="text-gray-500 text-xs">Yield mínimo</p>
                    <p className="font-medium">{inv.min_yield}% bruto</p>
                  </div>
                </div>
              )}

              {/* Zonas */}
              {inv.preferred_zones.length > 0 && (
                <div className="flex items-start gap-2">
                  <MapPin size={14} className="text-gray-400 mt-0.5" />
                  <div>
                    <p className="text-gray-500 text-xs">Zonas preferidas</p>
                    <p className="font-medium">{inv.preferred_zones.join(', ')}</p>
                  </div>
                </div>
              )}

              {/* Tipologias */}
              {inv.preferred_typologies.length > 0 && (
                <div>
                  <p className="text-gray-500 text-xs mb-1">Tipologias</p>
                  <div className="flex gap-1 flex-wrap">
                    {inv.preferred_typologies.map((t) => (
                      <Badge key={t} variant="outline" className="text-xs">{t}</Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Tipos */}
              {inv.investment_type.length > 0 && (
                <div>
                  <p className="text-gray-500 text-xs mb-1">Tipo de investimento</p>
                  <div className="flex gap-1 flex-wrap">
                    {inv.investment_type.map((t) => (
                      <Badge key={t} variant="outline" className="text-xs">
                        {INVESTMENT_TYPE_LABELS[t as keyof typeof INVESTMENT_TYPE_LABELS]}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              <div className="border-t pt-3 space-y-2">
                <div className="flex justify-between">
                  <span className="text-gray-500">Risco</span>
                  <span className="font-medium">{RISK_LEVEL_LABELS[inv.risk_level]}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Horizonte</span>
                  <span className="font-medium">{INVESTMENT_HORIZON_LABELS[inv.investment_horizon]}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Obras máx.</span>
                  <span className="font-medium">{MAX_RENOVATION_LABELS[inv.max_renovation]}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Financiamento</span>
                  <span className="font-medium">{inv.needs_financing ? 'Necessita' : 'Não necessita'}</span>
                </div>
              </div>

              {inv.notes && (
                <div className="border-t pt-3">
                  <p className="text-gray-500 text-xs mb-1">Notas</p>
                  <p className="text-gray-700">{inv.notes}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Matches */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-900">
              Oportunidades em análise ({matchList.length})
            </h2>
            <Link href="/dashboard/matching">
              <Button variant="outline" size="sm">Ver todas as matches</Button>
            </Link>
          </div>

          {matchList.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-gray-400">
                <p>Sem oportunidades associadas ainda</p>
                <p className="text-sm mt-1">Vai a uma oportunidade e corre o Agente de Matching</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {matchList.map((m) => {
                const opp = m.opportunity as unknown as {
                  id: string; title: string; zone: string; typology: string | null;
                  asking_price: number; negotiated_price: number | null; status: string
                } | null
                return (
                  <Card key={m.id}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <Link href={`/dashboard/opportunities/${opp?.id}`} className="font-medium text-gray-900 hover:text-blue-600">
                            {opp?.title ?? 'Oportunidade'}
                          </Link>
                          <p className="text-sm text-gray-500">
                            {opp?.zone}{opp?.typology ? ` · ${opp.typology}` : ''}
                            {' · '}
                            {opp?.negotiated_price ? formatEur(opp.negotiated_price) : opp?.asking_price ? formatEur(opp.asking_price) : ''}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-lg font-bold text-gray-900">{m.match_score}</span>
                          <span className="text-xs text-gray-400">/100</span>
                          <Badge className={MATCH_STATUS_COLORS[m.status]}>
                            {MATCH_STATUS_LABELS[m.status]}
                          </Badge>
                        </div>
                      </div>

                      {/* Razões */}
                      {m.match_reasons.length > 0 && (
                        <div className="space-y-1">
                          {m.match_reasons.slice(0, 3).map((r, i) => (
                            <div key={i} className="flex items-center gap-1.5 text-xs text-gray-600">
                              {r.positive
                                ? <CheckCircle2 size={12} className="text-green-500 flex-shrink-0" />
                                : <AlertCircle size={12} className="text-orange-400 flex-shrink-0" />}
                              {r.reason}
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
