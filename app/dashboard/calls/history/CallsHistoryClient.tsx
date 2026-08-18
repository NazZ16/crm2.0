'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { ChevronDown, ChevronUp, Phone, MicOff, Smile, Meh, Frown, User, Users } from 'lucide-react'

export interface CallRow {
  id: string
  audio_duration_s: number | null
  coach_feedback: Record<string, unknown> | null
  transcript_formatted: string | null
  transcript_text: string | null
  created_at: string
  lead_id: string | null
  lead_name: string
  lead_phone: string | null
}

export interface ProspectingRow {
  occurred_at: string
  person_key: string
}

const SENTIMENT_LABEL: Record<string, string> = {
  muito_positivo: 'Muito positivo',
  positivo: 'Positivo',
  neutro: 'Neutro',
  negativo: 'Negativo',
  muito_negativo: 'Muito negativo',
}

const SENTIMENT_SCORE: Record<string, number> = {
  muito_positivo: 10,
  positivo: 8,
  neutro: 6,
  negativo: 4,
  muito_negativo: 2,
}

const SENTIMENT_COLOR: Record<string, string> = {
  muito_positivo: 'bg-green-100 text-green-700 border-green-200',
  positivo: 'bg-green-50 text-green-700 border-green-200',
  neutro: 'bg-gray-100 text-gray-700 border-gray-200',
  negativo: 'bg-orange-100 text-orange-700 border-orange-200',
  muito_negativo: 'bg-red-100 text-red-700 border-red-200',
}

function getSentiment(feedback: Record<string, unknown> | null): string | null {
  if (!feedback) return null
  const v = feedback['sentimento_lead']
  return typeof v === 'string' ? v : null
}

function getStringArray(feedback: Record<string, unknown> | null, key: string): string[] {
  if (!feedback) return []
  const v = feedback[key]
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string')
}

function getString(feedback: Record<string, unknown> | null, key: string): string | null {
  if (!feedback) return null
  const v = feedback[key]
  return typeof v === 'string' ? v : null
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return '-'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}m ${s.toString().padStart(2, '0')}s`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit' })
}

function dayKey(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const PROSPECTING_WINDOW_DAYS = 14

function buildDailyProspecting(prospecting: ProspectingRow[]) {
  const peopleByDay = new Map<string, Set<string>>()
  for (const row of prospecting) {
    const key = dayKey(row.occurred_at)
    if (!peopleByDay.has(key)) peopleByDay.set(key, new Set())
    peopleByDay.get(key)!.add(row.person_key)
  }

  const days = Array.from({ length: PROSPECTING_WINDOW_DAYS }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - (PROSPECTING_WINDOW_DAYS - 1 - i))
    const key = dayKey(d.toISOString())
    return {
      dia: formatDateShort(d.toISOString()),
      pessoas: peopleByDay.get(key)?.size ?? 0,
    }
  })

  const todayKey = dayKey(new Date().toISOString())
  const todayCount = peopleByDay.get(todayKey)?.size ?? 0

  return { days, todayCount }
}

function SentimentIcon({ sentiment }: { sentiment: string | null }) {
  if (!sentiment) return null
  if (sentiment === 'muito_positivo' || sentiment === 'positivo') {
    return <Smile size={14} className="text-green-500" />
  }
  if (sentiment === 'negativo' || sentiment === 'muito_negativo') {
    return <Frown size={14} className="text-red-500" />
  }
  return <Meh size={14} className="text-gray-400" />
}

function CoachPanel({ feedback }: { feedback: Record<string, unknown> | null }) {
  const positivos = getStringArray(feedback, 'pontos_positivos')
  const aMelhorar = getStringArray(feedback, 'a_melhorar')
  const proxima = getString(feedback, 'proxima_chamada')

  if (positivos.length === 0 && aMelhorar.length === 0 && !proxima) return null

  return (
    <div className="mt-3 pt-3 border-t border-gray-100 space-y-3 text-sm">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {positivos.length > 0 && (
          <div>
            <p className="font-semibold text-green-700 mb-1">Pontos positivos</p>
            <ul className="space-y-1">
              {positivos.map((p, i) => (
                <li key={i} className="text-gray-600 flex gap-1.5">
                  <span className="text-green-500 flex-shrink-0">+</span>
                  {p}
                </li>
              ))}
            </ul>
          </div>
        )}
        {aMelhorar.length > 0 && (
          <div>
            <p className="font-semibold text-orange-700 mb-1">A melhorar</p>
            <ul className="space-y-1">
              {aMelhorar.map((p, i) => (
                <li key={i} className="text-gray-600 flex gap-1.5">
                  <span className="text-orange-500 flex-shrink-0">-</span>
                  {p}
                </li>
              ))}
            </ul>
          </div>
        )}
        {proxima && (
          <div>
            <p className="font-semibold text-blue-700 mb-1">Proxima chamada</p>
            <p className="text-gray-600">{proxima}</p>
          </div>
        )}
      </div>
    </div>
  )
}

export function CallsHistoryClient({ calls, prospecting }: { calls: CallRow[]; prospecting: ProspectingRow[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const { days: dailyProspecting, todayCount: todayPeopleCount } = buildDailyProspecting(prospecting)

  if (calls.length === 0) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Historico de Chamadas</h1>
          <p className="text-sm text-gray-500 mt-0.5">Sentimento das leads e feedback do Coach IA</p>
        </div>
        <div className="text-center py-20 bg-white rounded-xl border border-dashed border-gray-200">
          <MicOff size={40} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-400 font-medium">Sem chamadas analisadas ainda</p>
          <p className="text-sm text-gray-300 mt-1">
            Faz upload de um audio de chamada para comecar
          </p>
        </div>
      </div>
    )
  }

  // Chart data com sentiment_score (0-10) por chamada
  const chartData = [...calls]
    .reverse()
    .map((c) => {
      const sent = getSentiment(c.coach_feedback)
      return {
        data: formatDateShort(c.created_at),
        nota: sent ? SENTIMENT_SCORE[sent] ?? 0 : 0,
        fullDate: formatDate(c.created_at),
        leadName: c.lead_name,
        sentimento: sent ? SENTIMENT_LABEL[sent] ?? sent : 'Sem feedback',
      }
    })

  const validCalls = calls.filter((c) => getSentiment(c.coach_feedback) != null)
  const positiveCount = validCalls.filter((c) => {
    const s = getSentiment(c.coach_feedback)
    return s === 'positivo' || s === 'muito_positivo'
  }).length
  const negativeCount = validCalls.filter((c) => {
    const s = getSentiment(c.coach_feedback)
    return s === 'negativo' || s === 'muito_negativo'
  }).length
  const totalDurationS = calls.reduce((sum, c) => sum + (c.audio_duration_s ?? 0), 0)
  const totalMinutes = Math.round(totalDurationS / 60)

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Historico de Chamadas</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {calls.length} chamada{calls.length !== 1 ? 's' : ''} analisada{calls.length !== 1 ? 's' : ''}
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-teal-50 rounded-lg">
                <Users size={18} className="text-teal-600" />
              </div>
              <div>
                <div className="text-2xl font-bold text-teal-700">{todayPeopleCount}</div>
                <div className="text-xs text-gray-500">Pessoas hoje</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-50 rounded-lg">
                <Phone size={18} className="text-blue-600" />
              </div>
              <div>
                <div className="text-2xl font-bold text-gray-800">{calls.length}</div>
                <div className="text-xs text-gray-500">Total chamadas</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-50 rounded-lg">
                <Smile size={18} className="text-green-600" />
              </div>
              <div>
                <div className="text-2xl font-bold text-green-700">{positiveCount}</div>
                <div className="text-xs text-gray-500">Sentimento positivo</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-red-50 rounded-lg">
                <Frown size={18} className="text-red-500" />
              </div>
              <div>
                <div className="text-2xl font-bold text-red-600">{negativeCount}</div>
                <div className="text-xs text-gray-500">Sentimento negativo</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-50 rounded-lg">
                <Phone size={18} className="text-purple-600" />
              </div>
              <div>
                <div className="text-2xl font-bold text-gray-800">{totalMinutes}m</div>
                <div className="text-xs text-gray-500">Tempo total</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pessoas contactadas por dia (últimos {PROSPECTING_WINDOW_DAYS} dias)</CardTitle>
          <p className="text-xs text-gray-400">Chamadas, WhatsApp e email</p>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={dailyProspecting} margin={{ top: 4, right: 16, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
              <XAxis dataKey="dia" tick={{ fontSize: 12, fill: '#9ca3af' }} tickLine={false} axisLine={false} />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 12, fill: '#9ca3af' }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const d = payload[0].payload as (typeof dailyProspecting)[0]
                  return (
                    <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-3 text-sm">
                      <p className="font-medium text-gray-700">{d.dia}</p>
                      <p className="mt-1 font-bold text-gray-800">
                        {d.pessoas} pessoa{d.pessoas !== 1 ? 's' : ''}
                      </p>
                    </div>
                  )
                }}
              />
              <Bar dataKey="pessoas" fill="#14b8a6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {chartData.length >= 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sentimento das leads ao longo do tempo</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={chartData} margin={{ top: 4, right: 16, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="data" tick={{ fontSize: 12, fill: '#9ca3af' }} tickLine={false} axisLine={false} />
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
                        <p className="mt-1 font-bold text-gray-800">{d.sentimento}</p>
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
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Detalhe por chamada</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-gray-100">
            <div className="grid grid-cols-[1fr_1.5fr_auto_auto_auto] gap-4 px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">
              <span>Data</span>
              <span>Lead</span>
              <span>Sentimento</span>
              <span>Duracao</span>
              <span />
            </div>

            {calls.map((call) => {
              const isExpanded = expandedId === call.id
              const sent = getSentiment(call.coach_feedback)
              const positivos = getStringArray(call.coach_feedback, 'pontos_positivos')
              const aMelhorar = getStringArray(call.coach_feedback, 'a_melhorar')
              const proxima = getString(call.coach_feedback, 'proxima_chamada')
              const hasDetails = positivos.length + aMelhorar.length > 0 || !!proxima

              return (
                <div key={call.id} className="px-6 py-4">
                  <div className="grid grid-cols-[1fr_1.5fr_auto_auto_auto] gap-4 items-center">
                    <span className="text-sm text-gray-600">{formatDate(call.created_at)}</span>
                    <div className="min-w-0">
                      {call.lead_id ? (
                        <Link
                          href={`/dashboard/leads/${call.lead_id}`}
                          className="text-sm font-medium text-blue-600 hover:text-blue-800 truncate inline-flex items-center gap-1"
                        >
                          <User size={12} />
                          {call.lead_name}
                        </Link>
                      ) : (
                        <span className="text-sm text-gray-400">{call.lead_name}</span>
                      )}
                    </div>
                    {sent ? (
                      <Badge variant="outline" className={`text-xs ${SENTIMENT_COLOR[sent] ?? ''}`}>
                        <span className="inline-flex items-center gap-1">
                          <SentimentIcon sentiment={sent} />
                          {SENTIMENT_LABEL[sent] ?? sent}
                        </span>
                      </Badge>
                    ) : (
                      <span className="text-xs text-gray-400">-</span>
                    )}
                    <span className="text-sm text-gray-500">{formatDuration(call.audio_duration_s)}</span>
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : call.id)}
                      disabled={!hasDetails}
                      className="p-1 rounded hover:bg-gray-100 transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-gray-400"
                      aria-label={isExpanded ? 'Fechar detalhes' : 'Ver detalhes'}
                    >
                      {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>
                  </div>

                  {isExpanded && hasDetails && <CoachPanel feedback={call.coach_feedback} />}
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
