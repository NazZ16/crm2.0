'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Home, RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react'
import type { LeadListingMatchResult } from '@/lib/types'

function formatPrice(price: number | null): string {
  if (price == null) return 'Sob consulta'
  return new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(price)
}

export function ListingMatchesCard({ leadId }: { leadId: string }) {
  const [matches, setMatches] = useState<LeadListingMatchResult[] | null>(null)
  const [loading, setLoading] = useState(false)

  const loadMatches = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/leads/${leadId}/matches`)
    if (res.ok) setMatches(await res.json())
    setLoading(false)
  }, [leadId])

  useEffect(() => { loadMatches() }, [loadMatches])

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold text-gray-700 uppercase tracking-wide flex items-center gap-1.5">
            <Home size={14} /> Imoveis compativeis
          </CardTitle>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" onClick={loadMatches} disabled={loading}>
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> Atualizar
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading && !matches ? (
          <p className="text-xs text-gray-400">A calcular matches...</p>
        ) : !matches || matches.length === 0 ? (
          <p className="text-xs text-gray-400">
            Sem imoveis compativeis por agora. Verifica se a lead tem preferencias (zona, tipologia, orcamento) preenchidas.
          </p>
        ) : (
          <div className="space-y-3">
            {matches.map((m) => (
              <div key={m.listing_id} className="p-2.5 rounded-lg border border-gray-100">
                <div className="flex items-center justify-between mb-1 gap-2">
                  <Link href={`/dashboard/listings/${m.listing_id}`} className="font-medium text-sm text-gray-900 hover:text-blue-600 truncate">
                    {m.listing_title}
                  </Link>
                  <span className="text-sm font-bold text-gray-700 flex-shrink-0">{m.score}<span className="text-xs text-gray-400">/100</span></span>
                </div>
                <p className="text-xs text-gray-500 mb-1">{formatPrice(m.listing_price)}</p>
                <div className="space-y-0.5">
                  {m.reasons.slice(0, 3).map((r, i) => (
                    <div key={i} className="flex items-center gap-1 text-xs text-gray-600">
                      {r.positive ? <CheckCircle2 size={10} className="text-green-500 flex-shrink-0" /> : <AlertCircle size={10} className="text-orange-400 flex-shrink-0" />}
                      {r.reason}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
