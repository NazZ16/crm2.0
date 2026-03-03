'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Sparkles, Loader2, TrendingUp, TrendingDown, Minus, PauseCircle, ChevronDown, ChevronUp } from 'lucide-react'
import type { MarketingAnalysis } from '@/lib/agents/marketing-agent'

const PERFORMANCE_LABEL: Record<string, string> = {
  excellent: 'Excelente',
  good: 'Boa',
  average: 'Média',
  poor: 'Fraca',
}

const PERFORMANCE_COLOR: Record<string, string> = {
  excellent: 'bg-green-100 text-green-700',
  good: 'bg-blue-100 text-blue-700',
  average: 'bg-yellow-100 text-yellow-700',
  poor: 'bg-red-100 text-red-700',
}

const ACTION_ICON = {
  increase: TrendingUp,
  decrease: TrendingDown,
  maintain: Minus,
  pause: PauseCircle,
}

const ACTION_COLOR: Record<string, string> = {
  increase: 'text-green-600',
  decrease: 'text-red-500',
  maintain: 'text-gray-500',
  pause: 'text-yellow-500',
}

const ACTION_LABEL: Record<string, string> = {
  increase: 'Aumentar',
  decrease: 'Reduzir',
  maintain: 'Manter',
  pause: 'Pausar',
}

export default function MarketingAnalysisButton() {
  const [loading, setLoading] = useState(false)
  const [analysis, setAnalysis] = useState<MarketingAnalysis | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(true)

  async function runAnalysis() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/agents/marketing', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Erro desconhecido')
      } else {
        setAnalysis(data)
        setExpanded(true)
      }
    } catch {
      setError('Falha na comunicação com o servidor')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <Button
        onClick={runAnalysis}
        disabled={loading}
        className="gap-2 bg-purple-600 hover:bg-purple-700 text-white"
      >
        {loading ? (
          <><Loader2 size={16} className="animate-spin" /> A analisar campanhas...</>
        ) : (
          <><Sparkles size={16} /> Analisar com IA</>
        )}
      </Button>

      {error && (
        <p className="text-sm text-red-500 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
      )}

      {analysis && (
        <div className="border border-purple-100 rounded-xl bg-white shadow-sm overflow-hidden">
          <button
            onClick={() => setExpanded(e => !e)}
            className="w-full flex items-center justify-between px-4 py-3 bg-purple-50 hover:bg-purple-100 transition-colors text-left"
          >
            <div className="flex items-center gap-2">
              <Sparkles size={15} className="text-purple-600" />
              <span className="text-sm font-semibold text-purple-800">Análise IA — últimos 30 dias</span>
            </div>
            {expanded ? <ChevronUp size={16} className="text-purple-500" /> : <ChevronDown size={16} className="text-purple-500" />}
          </button>

          {expanded && (
            <div className="p-4 space-y-5">
              {/* Overall insights */}
              {analysis.overall_insights.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Insights Gerais</p>
                  <ul className="space-y-1.5">
                    {analysis.overall_insights.map((insight, i) => (
                      <li key={i} className="text-sm text-gray-700 flex gap-2">
                        <span className="text-purple-400 shrink-0">•</span>
                        {insight}
                      </li>
                    ))}
                  </ul>
                  {analysis.attribution_notes && (
                    <p className="text-xs text-gray-400 mt-2 italic">{analysis.attribution_notes}</p>
                  )}
                </div>
              )}

              {/* Campaign analysis */}
              {analysis.campaign_analysis.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Performance por Campanha</p>
                  <div className="space-y-3">
                    {analysis.campaign_analysis.map((c) => (
                      <div key={c.campaign_id} className="p-3 border border-gray-100 rounded-lg">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-sm font-medium text-gray-800">{c.campaign_name}</span>
                          <Badge className={`text-xs ${PERFORMANCE_COLOR[c.performance_rating]}`}>
                            {PERFORMANCE_LABEL[c.performance_rating]}
                          </Badge>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-center mb-2">
                          <div>
                            <div className="text-sm font-semibold text-gray-700">€{c.cpl.toFixed(2)}</div>
                            <div className="text-xs text-gray-400">CPL</div>
                          </div>
                          <div>
                            <div className="text-sm font-semibold text-gray-700">{c.ctr_pct.toFixed(1)}%</div>
                            <div className="text-xs text-gray-400">CTR</div>
                          </div>
                          <div>
                            <div className="text-sm font-semibold text-gray-700">{c.conversion_rate_pct.toFixed(1)}%</div>
                            <div className="text-xs text-gray-400">Conversão</div>
                          </div>
                        </div>
                        {c.insights.length > 0 && (
                          <ul className="space-y-0.5">
                            {c.insights.map((ins, i) => (
                              <li key={i} className="text-xs text-gray-500 flex gap-1.5">
                                <span className="text-purple-300 shrink-0">–</span>{ins}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Budget recommendations */}
              {analysis.budget_recommendations.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Recomendações de Budget</p>
                  <div className="space-y-2">
                    {analysis.budget_recommendations.map((rec) => {
                      const Icon = ACTION_ICON[rec.action]
                      const campaign = analysis.campaign_analysis.find(c => c.campaign_id === rec.campaign_id)
                      return (
                        <div key={rec.campaign_id} className="flex items-start gap-3 p-2.5 bg-gray-50 rounded-lg">
                          <Icon size={16} className={`mt-0.5 shrink-0 ${ACTION_COLOR[rec.action]}`} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-gray-800">
                                {campaign?.campaign_name ?? rec.campaign_id.slice(0, 8)}
                              </span>
                              <span className={`text-xs font-semibold ${ACTION_COLOR[rec.action]}`}>
                                {ACTION_LABEL[rec.action]}{rec.change_pct > 0 ? ` ${rec.change_pct}%` : ''}
                              </span>
                            </div>
                            <p className="text-xs text-gray-500 mt-0.5">{rec.reason}</p>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
