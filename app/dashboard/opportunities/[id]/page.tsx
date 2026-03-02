'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  OPPORTUNITY_STATUS_LABELS, PROPERTY_TYPE_LABELS, MATCH_STATUS_LABELS,
  type Opportunity, type InvestorMatch,
} from '@/lib/types'
import { calcularRoi, formatEur, formatPct } from '@/lib/roi-calculator'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from 'sonner'
import {
  ArrowLeft, MapPin, Bot, TrendingUp, CheckCircle2, AlertCircle,
  RefreshCw, Phone, Mail,
} from 'lucide-react'

const STATUS_COLORS: Record<string, string> = {
  analyzing: 'bg-yellow-100 text-yellow-800',
  available: 'bg-green-100 text-green-800',
  under_offer: 'bg-blue-100 text-blue-800',
  closed: 'bg-gray-100 text-gray-700',
  passed: 'bg-red-100 text-red-700',
}

const MATCH_STATUS_COLORS: Record<string, string> = {
  suggested: 'bg-gray-100 text-gray-700',
  presented: 'bg-blue-100 text-blue-800',
  interested: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-700',
  invested: 'bg-emerald-100 text-emerald-800',
}

interface OppWithMatches extends Opportunity {
  matches: (InvestorMatch & {
    investors: { id: string; name: string; phone: string | null; email: string | null }
  })[]
}

export default function OpportunityDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [opp, setOpp] = useState<OppWithMatches | null>(null)
  const [loading, setLoading] = useState(true)
  const [matchLoading, setMatchLoading] = useState(false)
  const [updatingMatch, setUpdatingMatch] = useState<string | null>(null)

  async function loadOpportunity() {
    const res = await fetch(`/api/opportunities/${id}`)
    if (!res.ok) { router.push('/dashboard/opportunities'); return }
    const data = await res.json()
    setOpp(data)
    setLoading(false)
  }

  useEffect(() => { loadOpportunity() }, [id])

  async function runMatchingAgent() {
    setMatchLoading(true)
    try {
      const res = await fetch('/api/agents/investor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ opportunity_id: id }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Erro no agente de matching')
        return
      }
      toast.success(`${data.matches_count} investidores encontrados!`)
      await loadOpportunity()
    } catch {
      toast.error('Erro de ligação')
    } finally {
      setMatchLoading(false)
    }
  }

  async function updateMatchStatus(matchId: string, status: string) {
    setUpdatingMatch(matchId)
    const res = await fetch(`/api/matches?id=${matchId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    if (res.ok) {
      await loadOpportunity()
      toast.success('Estado atualizado')
    }
    setUpdatingMatch(null)
  }

  if (loading) {
    return <div className="p-6 text-gray-400">A carregar...</div>
  }

  if (!opp) return null

  const roi = calcularRoi(opp)
  const preco = opp.negotiated_price ?? opp.asking_price

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      {/* Breadcrumb */}
      <Link href="/dashboard/opportunities" className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1">
        <ArrowLeft size={14} />
        Voltar às oportunidades
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{opp.title}</h1>
          <div className="flex items-center gap-3 mt-1">
            <Badge className={STATUS_COLORS[opp.status]}>{OPPORTUNITY_STATUS_LABELS[opp.status]}</Badge>
            <span className="flex items-center gap-1 text-sm text-gray-500">
              <MapPin size={12} />
              {opp.zone}{opp.typology ? ` · ${opp.typology}` : ''}
              {opp.address ? ` · ${opp.address}` : ''}
            </span>
          </div>
        </div>
        <Button
          onClick={runMatchingAgent}
          disabled={matchLoading}
          className="gap-2"
        >
          {matchLoading ? <RefreshCw size={15} className="animate-spin" /> : <Bot size={15} />}
          {matchLoading ? 'A analisar...' : 'Encontrar Investidores'}
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Dados + ROI */}
        <div className="lg:col-span-1 space-y-4">
          {/* Preço */}
          <Card>
            <CardHeader><CardTitle className="text-sm text-gray-500 uppercase tracking-wide">Preço</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Pedido</span>
                <span className="font-medium">{formatEur(opp.asking_price)}</span>
              </div>
              {opp.negotiated_price && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Negociado</span>
                  <span className="font-bold text-green-700">{formatEur(opp.negotiated_price)}</span>
                </div>
              )}
              {opp.renovation_cost > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Obras</span>
                  <span>{formatEur(opp.renovation_cost)}</span>
                </div>
              )}
              <div className="flex justify-between pt-2 border-t">
                <span className="text-gray-500">Tipo</span>
                <span>{PROPERTY_TYPE_LABELS[opp.property_type]}</span>
              </div>
              {opp.source && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Fonte</span>
                  <span>{opp.source}</span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ROI */}
          {roi.yield_bruto > 0 && (
            <Card className="border-green-200">
              <CardHeader>
                <CardTitle className="text-sm text-green-700 flex items-center gap-2">
                  <TrendingUp size={14} />
                  Análise ROI
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between items-center">
                  <span className="text-gray-500">Yield Bruto</span>
                  <span className="font-bold text-green-700 text-base">{formatPct(roi.yield_bruto)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-500">Yield Líquido</span>
                  <span className="font-bold text-gray-700">{formatPct(roi.yield_liquido)}</span>
                </div>
                {opp.estimated_monthly_rent && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Renda mensal</span>
                    <span>{formatEur(opp.estimated_monthly_rent)}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-gray-500">Encargos anuais</span>
                  <span>{formatEur(roi.encargos_anuais)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Cash Flow Anual</span>
                  <span className={roi.cash_flow_anual >= 0 ? 'text-green-700 font-medium' : 'text-red-600 font-medium'}>
                    {roi.cash_flow_anual >= 0 ? '+' : ''}{formatEur(roi.cash_flow_anual)}
                  </span>
                </div>
                {roi.payback_anos && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Payback</span>
                    <span>{roi.payback_anos} anos</span>
                  </div>
                )}
                <div className="border-t pt-2 space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-400">IMT estimado</span>
                    <span>{formatEur(roi.imt)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-400">Escritura</span>
                    <span>{formatEur(roi.custos_escritura)}</span>
                  </div>
                  <div className="flex justify-between text-xs font-medium">
                    <span className="text-gray-500">Capital total</span>
                    <span>{formatEur(roi.capital_total_investido)}</span>
                  </div>
                </div>
                {roi.plus_valia_estimada && (
                  <div className="flex justify-between pt-1 border-t">
                    <span className="text-gray-500">Mais-valia estimada</span>
                    <span className="font-bold text-blue-700">{formatPct(roi.plus_valia_estimada)}</span>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {opp.description && (
            <Card>
              <CardHeader><CardTitle className="text-sm text-gray-500 uppercase tracking-wide">Descrição</CardTitle></CardHeader>
              <CardContent>
                <p className="text-sm text-gray-700 whitespace-pre-line">{opp.description}</p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Matches */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-900">
              Investidores com Match ({opp.matches?.length ?? 0})
            </h2>
          </div>

          {(!opp.matches || opp.matches.length === 0) ? (
            <Card>
              <CardContent className="py-12 text-center text-gray-400">
                <Bot size={32} className="mx-auto mb-3 text-gray-300" />
                <p className="font-medium">Ainda sem matches</p>
                <p className="text-sm mt-1">Clica em "Encontrar Investidores" para o agente IA fazer o matching</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {opp.matches.map((m) => {
                const inv = m.investors as unknown as { id: string; name: string; phone: string | null; email: string | null } | null
                const nextStatuses: Record<string, string> = {
                  suggested: 'presented',
                  presented: 'interested',
                  interested: 'invested',
                }
                const nextLabel: Record<string, string> = {
                  suggested: 'Marcar como Apresentado',
                  presented: 'Marcar como Interessado',
                  interested: 'Marcar como Investiu',
                }

                return (
                  <Card key={m.id} className={m.status === 'rejected' ? 'opacity-60' : ''}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <Link href={`/dashboard/investors/${inv?.id}`} className="font-semibold text-gray-900 hover:text-blue-600">
                            {inv?.name ?? 'Investidor'}
                          </Link>
                          <div className="flex gap-3 mt-0.5">
                            {inv?.phone && (
                              <a href={`tel:${inv.phone}`} className="text-xs text-gray-400 flex items-center gap-1 hover:text-gray-600">
                                <Phone size={10} /> {inv.phone}
                              </a>
                            )}
                            {inv?.email && (
                              <a href={`mailto:${inv.email}`} className="text-xs text-gray-400 flex items-center gap-1 hover:text-gray-600">
                                <Mail size={10} /> {inv.email}
                              </a>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="text-right">
                            <span className="text-2xl font-bold text-gray-900">{m.match_score}</span>
                            <span className="text-xs text-gray-400">/100</span>
                          </div>
                          <Badge className={MATCH_STATUS_COLORS[m.status]}>
                            {MATCH_STATUS_LABELS[m.status]}
                          </Badge>
                        </div>
                      </div>

                      {/* Razões do match */}
                      {m.match_reasons.length > 0 && (
                        <div className="space-y-1 mb-3">
                          {m.match_reasons.map((r, i) => (
                            <div key={i} className="flex items-center gap-1.5 text-xs text-gray-600">
                              {r.positive
                                ? <CheckCircle2 size={11} className="text-green-500 flex-shrink-0" />
                                : <AlertCircle size={11} className="text-orange-400 flex-shrink-0" />}
                              {r.reason}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Pitch draft */}
                      {m.pitch_draft && (
                        <div className="bg-blue-50 rounded-lg p-3 mb-3">
                          <p className="text-xs text-blue-600 font-medium mb-1">Sugestão de pitch</p>
                          <p className="text-sm text-blue-900 whitespace-pre-line">{m.pitch_draft}</p>
                        </div>
                      )}

                      {/* Acções */}
                      {m.status !== 'rejected' && m.status !== 'invested' && (
                        <div className="flex gap-2">
                          {nextStatuses[m.status] && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-xs"
                              disabled={updatingMatch === m.id}
                              onClick={() => updateMatchStatus(m.id, nextStatuses[m.status])}
                            >
                              {updatingMatch === m.id ? 'A atualizar...' : nextLabel[m.status]}
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-xs text-red-500 hover:text-red-700"
                            disabled={updatingMatch === m.id}
                            onClick={() => updateMatchStatus(m.id, 'rejected')}
                          >
                            Rejeitar
                          </Button>
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
