'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ExtractionReview } from '@/components/agent/ExtractionReview'
import { formatRelativeTime } from '@/lib/utils'
import {
  LEAD_STATUS_LABELS,
  LEAD_STATUS_COLORS,
  LEAD_TYPE_LABELS,
  LEAD_TYPE_COLORS,
  type LeadStatus,
  type LeadType,
  type AgentExtractionResult,
  type AgentRecommendations,
  type AgentDrafts,
} from '@/lib/types'
import { toast } from 'sonner'
import { Sparkles, Loader2, ChevronRight, HelpCircle } from 'lucide-react'

export interface Respondente {
  id: string
  full_name: string
  phone: string | null
  status: LeadStatus
  lead_type: LeadType
  score: number
  urgency: number
  lastMessageText: string
  lastMessageAt: string
  pendingExtraction: {
    id: string
    extracted_json: AgentExtractionResult
    recommendations_json: AgentRecommendations
    drafts_json: AgentDrafts
  } | null
}

interface Props {
  respondentes: Respondente[]
  days: number
  daysOptions: number[]
}

export function RespondentesClient({ respondentes, days, daysOptions }: Props) {
  const router = useRouter()
  const [analyzing, setAnalyzing] = useState<Set<string>>(new Set())

  function applyDaysFilter(d: number) {
    const params = new URLSearchParams()
    if (d !== 14) params.set('days', String(d))
    const qs = params.toString()
    router.push(`/dashboard/respondentes${qs ? '?' + qs : ''}`)
  }

  async function analyzeNow(leadId: string) {
    setAnalyzing((s) => new Set(s).add(leadId))
    try {
      const res = await fetch(`/api/leads/${leadId}/analyze-all`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? 'Erro na análise')
        return
      }
      toast.success('Análise concluída — revê abaixo')
      router.refresh()
    } catch {
      toast.error('Erro de ligação')
    } finally {
      setAnalyzing((s) => {
        const n = new Set(s)
        n.delete(leadId)
        return n
      })
    }
  }

  return (
    <>
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 md:mx-0 md:px-0 md:flex-wrap items-center">
        <span className="text-xs text-gray-400 flex-shrink-0">Janela:</span>
        {daysOptions.map((d) => (
          <Badge
            key={d}
            variant={days === d ? 'default' : 'outline'}
            onClick={() => applyDaysFilter(d)}
            className="cursor-pointer text-xs px-2.5 py-1 flex-shrink-0 whitespace-nowrap"
          >
            {d}+ dias
          </Badge>
        ))}
      </div>

      {respondentes.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-gray-400">
            <p className="text-base font-medium">Sem respostas nesta janela</p>
            <p className="text-xs mt-1">
              Ninguém respondeu por WhatsApp nos últimos {days} dias. Tenta um intervalo maior, ou
              vai a{' '}
              <Link href="/dashboard/cold-leads" className="text-blue-600 hover:underline">
                Leads frias
              </Link>{' '}
              para reactivar alguém.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {respondentes.map((r) => {
            const isAnalyzing = analyzing.has(r.id)
            const needsClassification = r.lead_type === 'unknown' && !r.pendingExtraction

            return (
              <Card key={r.id}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link href={`/dashboard/leads/${r.id}`} className="font-semibold text-gray-900 hover:text-blue-600">
                          {r.full_name}
                        </Link>
                        <Badge className={`text-xs ${LEAD_TYPE_COLORS[r.lead_type]}`}>
                          {LEAD_TYPE_LABELS[r.lead_type]}
                        </Badge>
                        <Badge className={`text-xs ${LEAD_STATUS_COLORS[r.status]}`}>
                          {LEAD_STATUS_LABELS[r.status]}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-gray-500 mt-1 flex-wrap">
                        <span className="text-green-600 font-medium">
                          respondeu {formatRelativeTime(r.lastMessageAt)}
                        </span>
                        <span>Score {r.score}</span>
                        {r.urgency >= 4 && <span className="text-orange-600">Urg {r.urgency}/5</span>}
                        {r.phone && <span className="truncate">{r.phone}</span>}
                      </div>
                      {r.lastMessageText && (
                        <p className="text-xs text-gray-600 mt-1.5 line-clamp-2 italic">&quot;{r.lastMessageText}&quot;</p>
                      )}
                    </div>
                    <Link
                      href={`/dashboard/leads/${r.id}`}
                      className="text-xs text-blue-600 hover:text-blue-800 inline-flex items-center gap-0.5 flex-shrink-0"
                    >
                      Ver lead <ChevronRight size={12} />
                    </Link>
                  </div>

                  {needsClassification && (
                    <div className="flex items-center justify-between gap-2 flex-wrap bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                      <span className="text-xs text-amber-800 flex items-center gap-1.5">
                        <HelpCircle size={13} />
                        Intenção por classificar — ainda não sabemos se quer comprar ou vender
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs gap-1 bg-white"
                        onClick={() => analyzeNow(r.id)}
                        disabled={isAnalyzing}
                      >
                        {isAnalyzing ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                        Analisar agora
                      </Button>
                    </div>
                  )}

                  {r.pendingExtraction && (
                    <div className="pt-2 border-t border-gray-100">
                      <ExtractionReview
                        leadPhone={r.phone}
                        leadEmail={null}
                        leadUpdates={r.pendingExtraction.extracted_json}
                        recommendations={r.pendingExtraction.recommendations_json}
                        drafts={r.pendingExtraction.drafts_json}
                        extractionId={r.pendingExtraction.id}
                        onApplied={() => router.refresh()}
                        onDismissed={() => router.refresh()}
                      />
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </>
  )
}
