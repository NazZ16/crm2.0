'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { MATCH_STATUS_LABELS, type InvestorMatch } from '@/lib/types'
import { formatEur } from '@/lib/roi-calculator'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from 'sonner'
import { CheckCircle2, AlertCircle, ArrowRight, TrendingUp } from 'lucide-react'

type MatchStatus = 'suggested' | 'presented' | 'interested' | 'rejected' | 'invested'

const COLUMNS: { status: MatchStatus; label: string; color: string }[] = [
  { status: 'suggested', label: 'Sugerido', color: 'border-gray-300' },
  { status: 'presented', label: 'Apresentado', color: 'border-blue-300' },
  { status: 'interested', label: 'Interessado', color: 'border-green-300' },
  { status: 'invested', label: 'Investiu', color: 'border-emerald-400' },
]

const MATCH_BADGE: Record<MatchStatus, string> = {
  suggested: 'bg-gray-100 text-gray-700',
  presented: 'bg-blue-100 text-blue-800',
  interested: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-700',
  invested: 'bg-emerald-100 text-emerald-800',
}

interface MatchWithJoins extends InvestorMatch {
  investors: { id: string; name: string; phone: string | null }
  opportunities: { id: string; title: string; zone: string; asking_price: number; negotiated_price: number | null }
}

export default function MatchingPage() {
  const [matches, setMatches] = useState<MatchWithJoins[]>([])
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState<string | null>(null)
  const [filter, setFilter] = useState<MatchStatus | 'all'>('all')

  async function loadMatches() {
    const res = await fetch('/api/matches')
    if (res.ok) {
      const data = await res.json()
      setMatches(data)
    }
    setLoading(false)
  }

  useEffect(() => { loadMatches() }, [])

  async function updateStatus(matchId: string, status: MatchStatus) {
    setUpdating(matchId)
    const res = await fetch(`/api/matches?id=${matchId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    if (res.ok) {
      setMatches((prev) => prev.map((m) => m.id === matchId ? { ...m, status } : m))
      toast.success('Estado atualizado')
    }
    setUpdating(null)
  }

  const activeMatches = matches.filter((m) => m.status !== 'rejected')
  const rejectedMatches = matches.filter((m) => m.status === 'rejected')

  const displayMatches = filter === 'all' ? activeMatches : activeMatches.filter((m) => m.status === filter)

  const stats = {
    total: matches.length,
    active: activeMatches.length,
    interested: matches.filter((m) => m.status === 'interested').length,
    invested: matches.filter((m) => m.status === 'invested').length,
  }

  if (loading) return <div className="p-6 text-gray-400">A carregar...</div>

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard de Matches</h1>
          <p className="text-sm text-gray-500 mt-0.5">Gestão do pipeline de investidores</p>
        </div>
        <div className="flex gap-2">
          <Link href="/dashboard/investors/new">
            <Button variant="outline" size="sm">+ Investidor</Button>
          </Link>
          <Link href="/dashboard/opportunities/new">
            <Button size="sm">+ Oportunidade</Button>
          </Link>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Total Matches', value: stats.total, color: 'text-gray-900' },
          { label: 'Em Progresso', value: stats.active, color: 'text-blue-700' },
          { label: 'Interessados', value: stats.interested, color: 'text-green-700' },
          { label: 'Investiram', value: stats.invested, color: 'text-emerald-700' },
        ].map(({ label, value, color }) => (
          <Card key={label}>
            <CardContent className="p-4 text-center">
              <p className={`text-3xl font-bold ${color}`}>{value}</p>
              <p className="text-xs text-gray-500 mt-1">{label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filtros */}
      <div className="flex gap-2">
        <Badge
          variant={filter === 'all' ? 'default' : 'outline'}
          className="cursor-pointer px-3 py-1 text-sm"
          onClick={() => setFilter('all')}
        >
          Todos ({activeMatches.length})
        </Badge>
        {COLUMNS.map(({ status, label }) => (
          <Badge
            key={status}
            variant={filter === status ? 'default' : 'outline'}
            className="cursor-pointer px-3 py-1 text-sm"
            onClick={() => setFilter(status)}
          >
            {label} ({matches.filter((m) => m.status === status).length})
          </Badge>
        ))}
      </div>

      {/* Lista de matches */}
      {displayMatches.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-gray-400">
            <p className="text-lg font-medium">Sem matches para mostrar</p>
            <p className="text-sm mt-1">
              Vai a uma oportunidade e clica em "Encontrar Investidores" para gerar matches com IA
            </p>
            <Link href="/dashboard/opportunities">
              <Button className="mt-4 gap-2" variant="outline">
                Ver Oportunidades <ArrowRight size={14} />
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {displayMatches.map((m) => {
            const inv = m.investors as unknown as { id: string; name: string; phone: string | null } | null
            const opp = m.opportunities as unknown as { id: string; title: string; zone: string; asking_price: number; negotiated_price: number | null } | null
            const preco = opp?.negotiated_price ?? opp?.asking_price ?? 0

            const nextMap: Record<string, MatchStatus> = {
              suggested: 'presented',
              presented: 'interested',
              interested: 'invested',
            }
            const nextLabelMap: Record<string, string> = {
              suggested: 'Apresentado',
              presented: 'Interessado',
              interested: 'Investiu',
            }

            return (
              <Card key={m.id}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-4">
                    {/* Score */}
                    <div className="flex-shrink-0 text-center w-14">
                      <span className="text-3xl font-bold text-gray-900">{m.match_score}</span>
                      <p className="text-xs text-gray-400">match</p>
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <div>
                          <Link href={`/dashboard/investors/${inv?.id}`} className="font-semibold text-gray-900 hover:text-blue-600">
                            {inv?.name ?? '—'}
                          </Link>
                          <span className="text-gray-400 mx-1.5">→</span>
                          <Link href={`/dashboard/opportunities/${opp?.id}`} className="font-medium text-gray-700 hover:text-blue-600">
                            {opp?.title ?? '—'}
                          </Link>
                        </div>
                        <Badge className={MATCH_BADGE[m.status as MatchStatus]}>
                          {MATCH_STATUS_LABELS[m.status as MatchStatus]}
                        </Badge>
                      </div>

                      <div className="flex items-center gap-3 text-xs text-gray-500 mb-2">
                        {opp?.zone && <span>{opp.zone}</span>}
                        {preco > 0 && <span className="flex items-center gap-1"><TrendingUp size={10} />{formatEur(preco)}</span>}
                        {inv?.phone && <span>{inv.phone}</span>}
                      </div>

                      {/* Razões */}
                      {m.match_reasons.length > 0 && (
                        <div className="flex gap-3 flex-wrap">
                          {m.match_reasons.slice(0, 3).map((r, i) => (
                            <div key={i} className="flex items-center gap-1 text-xs text-gray-600">
                              {r.positive
                                ? <CheckCircle2 size={10} className="text-green-500" />
                                : <AlertCircle size={10} className="text-orange-400" />}
                              {r.reason}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Acções */}
                    {m.status !== 'invested' && (
                      <div className="flex-shrink-0 flex flex-col gap-1.5">
                        {nextMap[m.status] && (
                          <Button
                            size="sm"
                            className="text-xs h-7"
                            disabled={updating === m.id}
                            onClick={() => updateStatus(m.id, nextMap[m.status])}
                          >
                            → {nextLabelMap[m.status]}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-xs h-7 text-red-400 hover:text-red-600"
                          disabled={updating === m.id}
                          onClick={() => updateStatus(m.id, 'rejected')}
                        >
                          Rejeitar
                        </Button>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Rejeitados (colapsado) */}
      {rejectedMatches.length > 0 && (
        <details className="mt-4">
          <summary className="text-sm text-gray-400 cursor-pointer hover:text-gray-600">
            {rejectedMatches.length} match(es) rejeitado(s)
          </summary>
          <div className="mt-2 space-y-2">
            {rejectedMatches.map((m) => {
              const inv = m.investors as unknown as { name: string } | null
              const opp = m.opportunities as unknown as { title: string } | null
              return (
                <div key={m.id} className="text-sm text-gray-400 px-2 py-1 flex items-center gap-2">
                  <span className="font-medium text-gray-500">{m.match_score}</span>
                  <span>{inv?.name}</span>
                  <span>→</span>
                  <span>{opp?.title}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-xs h-6 ml-auto"
                    onClick={() => updateStatus(m.id, 'suggested')}
                  >
                    Restaurar
                  </Button>
                </div>
              )
            })}
          </div>
        </details>
      )}
    </div>
  )
}
