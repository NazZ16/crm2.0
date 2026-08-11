'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Home, RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import {
  INTERACTION_OUTCOME_LABELS,
  REJECTION_REASON_LABELS,
  type LeadListingMatchResult,
  type InteractionOutcome,
  type RejectionReason,
} from '@/lib/types'

function formatPrice(price: number | null): string {
  if (price == null) return 'Sob consulta'
  return new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(price)
}

export function ListingMatchesCard({ leadId }: { leadId: string }) {
  const [matches, setMatches] = useState<LeadListingMatchResult[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [registered, setRegistered] = useState<Record<string, InteractionOutcome>>({})
  const [pendingRejection, setPendingRejection] = useState<Record<string, boolean>>({})
  const [pendingReason, setPendingReason] = useState<Record<string, RejectionReason | undefined>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})

  const loadMatches = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/leads/${leadId}/matches`)
    if (res.ok) setMatches(await res.json())
    setLoading(false)
  }, [leadId])

  useEffect(() => { loadMatches() }, [loadMatches])

  async function registerOutcome(listingId: string, outcome: InteractionOutcome, rejectionReason?: RejectionReason) {
    setSaving((s) => ({ ...s, [listingId]: true }))
    const res = await fetch('/api/interactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lead_id: leadId,
        listing_id: listingId,
        type: 'note',
        outcome,
        rejection_reason: rejectionReason,
        summary: `Match: ${INTERACTION_OUTCOME_LABELS[outcome]}`,
      }),
    })
    setSaving((s) => ({ ...s, [listingId]: false }))
    if (res.ok) {
      setRegistered((r) => ({ ...r, [listingId]: outcome }))
      setPendingRejection((p) => ({ ...p, [listingId]: false }))
      toast.success('Resultado registado')
    } else {
      toast.error('Falha ao registar resultado')
    }
  }

  function handleOutcomeChange(listingId: string, value: string) {
    const outcome = value as InteractionOutcome
    if (outcome === 'rejeitado') {
      // Rejeitar pede confirmação (motivo opcional) em vez de gravar logo —
      // mas nada é persistido até o utilizador clicar "Confirmar". Sem esse
      // clique claro aqui, era fácil pensar que já tinha ficado registado.
      setPendingRejection((p) => ({ ...p, [listingId]: true }))
      setPendingReason((p) => ({ ...p, [listingId]: undefined }))
      return
    }
    registerOutcome(listingId, outcome)
  }

  function cancelRejection(listingId: string) {
    setPendingRejection((p) => ({ ...p, [listingId]: false }))
    setPendingReason((p) => ({ ...p, [listingId]: undefined }))
  }

  function confirmRejection(listingId: string) {
    registerOutcome(listingId, 'rejeitado', pendingReason[listingId])
  }

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
                <div className="mt-2 flex items-center gap-2">
                  <Select
                    value={registered[m.listing_id] ?? (pendingRejection[m.listing_id] ? 'rejeitado' : undefined)}
                    onValueChange={(v) => handleOutcomeChange(m.listing_id, v)}
                    disabled={saving[m.listing_id]}
                  >
                    <SelectTrigger className="h-7 text-xs w-[150px]">
                      <SelectValue placeholder="Registar resultado" />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(INTERACTION_OUTCOME_LABELS) as InteractionOutcome[]).map((o) => (
                        <SelectItem key={o} value={o}>{INTERACTION_OUTCOME_LABELS[o]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {pendingRejection[m.listing_id] && (
                  <div className="mt-2 p-2 rounded border border-orange-200 bg-orange-50 space-y-2">
                    <p className="text-[11px] text-orange-700">
                      Só fica registado depois de clicares em Confirmar. Motivo e opcional.
                    </p>
                    <div className="flex items-center gap-2">
                      <Select
                        value={pendingReason[m.listing_id]}
                        onValueChange={(v) => setPendingReason((p) => ({ ...p, [m.listing_id]: v as RejectionReason }))}
                        disabled={saving[m.listing_id]}
                      >
                        <SelectTrigger className="h-7 text-xs w-[140px]">
                          <SelectValue placeholder="Motivo (opcional)" />
                        </SelectTrigger>
                        <SelectContent>
                          {(Object.keys(REJECTION_REASON_LABELS) as RejectionReason[]).map((r) => (
                            <SelectItem key={r} value={r}>{REJECTION_REASON_LABELS[r]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        size="sm"
                        className="h-7 text-xs px-2"
                        disabled={saving[m.listing_id]}
                        onClick={() => confirmRejection(m.listing_id)}
                      >
                        Confirmar
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs px-2"
                        disabled={saving[m.listing_id]}
                        onClick={() => cancelRejection(m.listing_id)}
                      >
                        Cancelar
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
