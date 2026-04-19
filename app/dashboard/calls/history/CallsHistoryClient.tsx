'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { ChevronDown, ChevronUp, Phone, MicOff } from 'lucide-react'

interface CallUpload {
  id: string
  duration_seconds: number | null
  nota_script: number | null
  script_analise: unknown  // JSON do Supabase, sem garantia de estrutura
  created_at: string
  lead_id: string | null
  leads: { full_name: string } | { full_name: string }[] | null
}

interface Props {
  calls: CallUpload[]
}

function getLeadName(leads: CallUpload['leads']): string {
  if (!leads) return 'Lead desconhecida'
  const lead = Array.isArray(leads) ? leads[0] : leads
  return lead?.full_name ?? 'Lead desconhecida'
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return '—'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}m ${s.toString().padStart(2, '0')}s`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-PT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-PT', {
    day: '2-digit',
    month: '2-digit',
  })
}

function NotaBadge({ nota }: { nota: number }) {
  const color =
    nota >= 8
      ? 'bg-green-100 text-green-700'
      : nota >= 6
      ? 'bg-yellow-100 text-yellow-700'
      : 'bg-red-100 text-red-700'
  return <Badge className={`text-sm font-semibold ${color}`}>{nota}/10</Badge>
}

function ScriptAnalisePanel({ rawAnalise }: { rawAnalise: unknown }) {
  const analise = rawAnalise as Record<string, unknown> | null
  const pontosFortes = Array.isArray(analise?.pontos_fortes) ? analise.pontos_fortes as string[] : []
  const pontosFracos = Array.isArray(analise?.pontos_fracos) ? analise.pontos_fracos as string[] : []
  const sugestoes = Array.isArray(analise?.sugestoes) ? analise.sugestoes as string[] : []
  const resumo = typeof analise?.resumo === 'string' ? analise.resumo : null

  return (
    <div className="mt-3 pt-3 border-t border-gray-100 space-y-3 text-sm">
      {resumo && (
        <p className="text-gray-600 italic">{resumo}</p>
      )}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {pontosFortes.length > 0 && (
          <div>
            <p className="font-semibold text-green-700 mb-1">Pontos fortes</p>
            <ul className="space-y-1">
              {pontosFortes.map((p, i) => (
                <li key={i} className="text-gray-600 flex gap-1.5">
                  <span className="text-green-500 flex-shrink-0">+</span>
                  {p}
                </li>
              ))}
            </ul>
          </div>
        )}
        {pontosFracos.length > 0 && (
          <div>
            <p className="font-semibold text-red-700 mb-1">Pontos a melhorar</p>
            <ul className="space-y-1">
              {pontosFracos.map((p, i) => (
                <li key={i} className="text-gray-600 flex gap-1.5">
                  <span className="text-red-500 flex-shrink-0">–</span>
                  {p}
                </li>
              ))}
            </ul>
          </div>
        )}
        {sugestoes.length > 0 && (
          <div>
            <p className="font-semibold text-blue-700 mb-1">Sugestões</p>
            <ul className="space-y-1">
              {sugestoes.map((p, i) => (
                <li key={i} className="text-gray-600 flex gap-1.5">
                  <span className="text-blue-500 flex-shrink-0">→</span>
                  {p}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}

export function CallsHistoryClient({ calls }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  if (calls.length === 0) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Histórico de Chamadas</h1>
          <p className="text-sm text-gray-500 mt-0.5">Evolução da qualidade do script ao longo do tempo</p>
        </div>
        <div className="text-center py-20 bg-white rounded-xl border border-dashed border-gray-200">
          <MicOff size={40} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-400 font-medium">Sem chamadas analisadas ainda</p>
          <p className="text-sm text-gray-300 mt-1">
            Faz upload de um áudio de chamada para começar
          </p>
        </div>
      </div>
    )
  }

  // Prepare chart data — oldest first for the line chart
  const chartData = [...calls]
    .reverse()
    .map((c) => ({
      data: formatDateShort(c.created_at),
      nota: c.nota_script ?? 0,
      fullDate: formatDate(c.created_at),
      leadName: getLeadName(c.leads),
    }))

  const validCalls = calls.filter(c => c.nota_script !== null)
  const avgNota = validCalls.length > 0
    ? validCalls.reduce((sum, c) => sum + (c.nota_script ?? 0), 0) / validCalls.length
    : null
  const bestNota = validCalls.length > 0 ? Math.max(...validCalls.map(c => c.nota_script!)) : null
  const worstNota = validCalls.length > 0 ? Math.min(...validCalls.map(c => c.nota_script!)) : null

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Histórico de Chamadas</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Evolução da qualidade do script — {calls.length} chamada{calls.length !== 1 ? 's' : ''} analisada{calls.length !== 1 ? 's' : ''}
        </p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-50 rounded-lg">
                <Phone size={18} className="text-blue-600" />
              </div>
              <div>
                <div className="text-2xl font-bold text-gray-800">{avgNota !== null ? avgNota.toFixed(1) : '—'}</div>
                <div className="text-xs text-gray-500">Nota média</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-50 rounded-lg">
                <Phone size={18} className="text-green-600" />
              </div>
              <div>
                <div className="text-2xl font-bold text-green-700">{bestNota !== null ? `${bestNota}/10` : '—'}</div>
                <div className="text-xs text-gray-500">Melhor nota</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-red-50 rounded-lg">
                <Phone size={18} className="text-red-500" />
              </div>
              <div>
                <div className="text-2xl font-bold text-red-600">{worstNota !== null ? `${worstNota}/10` : '—'}</div>
                <div className="text-xs text-gray-500">Nota mais baixa</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Line chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Evolução da nota do script</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData} margin={{ top: 4, right: 16, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis
                dataKey="data"
                tick={{ fontSize: 12, fill: '#9ca3af' }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                domain={[0, 10]}
                ticks={[0, 2, 4, 6, 8, 10]}
                tick={{ fontSize: 12, fill: '#9ca3af' }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const d = payload[0].payload as (typeof chartData)[0]
                  return (
                    <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-3 text-sm">
                      <p className="font-medium text-gray-700">{d.fullDate}</p>
                      <p className="text-gray-500 text-xs">{d.leadName}</p>
                      <p className="mt-1 font-bold text-gray-800">Nota: {d.nota}/10</p>
                    </div>
                  )
                }}
              />
              <Line
                type="monotone"
                dataKey="nota"
                stroke="#14b8a6"
                strokeWidth={2.5}
                dot={{ r: 4, fill: '#14b8a6', strokeWidth: 0 }}
                activeDot={{ r: 6, fill: '#0d9488' }}
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Detalhe por chamada</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-gray-100">
            {/* Header row */}
            <div className="grid grid-cols-[1fr_1.5fr_auto_auto_auto] gap-4 px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">
              <span>Data</span>
              <span>Lead</span>
              <span>Nota</span>
              <span>Duração</span>
              <span />
            </div>

            {calls.map((call) => {
              const isExpanded = expandedId === call.id
              const rawAnalise = call.script_analise as Record<string, unknown> | null
              const hasDetails =
                rawAnalise != null &&
                (typeof rawAnalise.resumo === 'string' ||
                  (Array.isArray(rawAnalise.pontos_fortes) && rawAnalise.pontos_fortes.length > 0) ||
                  (Array.isArray(rawAnalise.pontos_fracos) && rawAnalise.pontos_fracos.length > 0) ||
                  (Array.isArray(rawAnalise.sugestoes) && rawAnalise.sugestoes.length > 0))

              return (
                <div key={call.id} className="px-6 py-4">
                  <div className="grid grid-cols-[1fr_1.5fr_auto_auto_auto] gap-4 items-center">
                    <span className="text-sm text-gray-600">{formatDate(call.created_at)}</span>
                    <span className="text-sm font-medium text-gray-800 truncate">
                      {getLeadName(call.leads)}
                    </span>
                    <NotaBadge nota={call.nota_script ?? 0} />
                    <span className="text-sm text-gray-500">{formatDuration(call.duration_seconds)}</span>
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : call.id)}
                      disabled={!hasDetails}
                      className="p-1 rounded hover:bg-gray-100 transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-gray-400"
                      aria-label={isExpanded ? 'Fechar detalhes' : 'Ver detalhes'}
                    >
                      {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>
                  </div>

                  {isExpanded && hasDetails && (
                    <ScriptAnalisePanel rawAnalise={call.script_analise} />
                  )}
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
