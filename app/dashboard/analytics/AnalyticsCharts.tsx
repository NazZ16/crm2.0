'use client'

import {
  AreaChart, Area,
  BarChart, Bar,
  ComposedChart, Line,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { LeadStatus } from '@/lib/types'

export interface AnalyticsChartsData {
  weeklyData: { week: string; leads: number }[]
  pipelineData: {
    name: string
    status: LeadStatus
    value: number
    fill: string
    pctOfTotal: number | null
    pctOfPrevious: number | null
  }[]
  sourceData: { source: string; count: number; won: number; winRate: number }[]
  scoreData: { range: string; count: number; won: number; winRate: number | null }[]
  agentData: { type: string; label: string; runs: number }[]
}

function formatPct(pct: number | null): string {
  return pct === null ? '—' : `${pct.toFixed(0)}%`
}

const COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#3b82f6', '#ec4899']

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number; name?: string }[]; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-xs">
      <p className="font-medium text-gray-700 mb-1">{label}</p>
      {payload.map((p, i) => (
        <p key={i} className="text-gray-600">{p.name ? `${p.name}: ` : ''}<span className="font-bold">{p.value}</span></p>
      ))}
    </div>
  )
}

interface BarLabelProps {
  x?: number | string
  y?: number | string
  width?: number | string
  height?: number | string
  index?: number
}

export default function AnalyticsCharts({ weeklyData, pipelineData, sourceData, scoreData, agentData }: AnalyticsChartsData) {
  const hasSourceData = sourceData.length > 0
  const hasAgentData = agentData.some(a => a.runs > 0)

  function renderPipelineLabel({ x = 0, y = 0, width = 0, height = 0, index }: BarLabelProps) {
    if (index === undefined) return null
    const d = pipelineData[index]
    if (!d) return null
    const label = d.pctOfTotal !== null ? `${d.value} · ${d.pctOfTotal.toFixed(0)}%` : `${d.value}`
    const nx = Number(x), ny = Number(y), nw = Number(width), nh = Number(height)
    return (
      <text x={nx + nw + 6} y={ny + nh / 2} dy={4} fontSize={11} fill="#6b7280" textAnchor="start">
        {label}
      </text>
    )
  }

  return (
    <div className="space-y-6">
      {/* Row 1: Weekly leads + Score distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-gray-700">Novas Leads por Semana</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={weeklyData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="leadGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.18} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="week" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                <Tooltip content={<CustomTooltip />} />
                <Area
                  type="monotone"
                  dataKey="leads"
                  name="Leads"
                  stroke="#6366f1"
                  strokeWidth={2}
                  fill="url(#leadGrad)"
                  dot={{ r: 3, fill: '#6366f1' }}
                  activeDot={{ r: 5 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-gray-700">Distribuição de Score IA</CardTitle>
            <p className="text-xs text-gray-400">Volume × taxa de vitória</p>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <ComposedChart data={scoreData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                <XAxis dataKey="range" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="count" allowDecimals={false} tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="winRate" orientation="right" domain={[0, 100]} tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                <Tooltip content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null
                  const d = payload[0].payload as AnalyticsChartsData['scoreData'][number]
                  return (
                    <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-xs">
                      <p className="font-medium text-gray-700 mb-1">{label}</p>
                      <p className="text-gray-600">Leads: {d.count}</p>
                      <p className="text-gray-600">Ganhas: {d.won} ({formatPct(d.winRate)})</p>
                    </div>
                  )
                }} />
                <Bar yAxisId="count" dataKey="count" name="Leads" radius={[4, 4, 0, 0]}>
                  {scoreData.map((_, i) => {
                    const colors = ['#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22c55e']
                    return <Cell key={i} fill={colors[i]} />
                  })}
                </Bar>
                <Line yAxisId="winRate" dataKey="winRate" name="Taxa de vitória" stroke="#14b8a6" strokeWidth={2.5} dot={{ r: 4, fill: '#14b8a6' }} connectNulls={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Row 2: Pipeline funnel + Sources */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-gray-700">Funil de Pipeline</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                data={pipelineData}
                layout="vertical"
                margin={{ top: 0, right: 55, left: 10, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fontSize: 11, fill: '#6b7280' }}
                  axisLine={false}
                  tickLine={false}
                  width={80}
                />
                <Tooltip content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const d = payload[0].payload as AnalyticsChartsData['pipelineData'][number]
                  return (
                    <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-xs">
                      <p className="font-medium text-gray-700 mb-1">{d.name}</p>
                      <p className="text-gray-600">{d.value} leads · {formatPct(d.pctOfTotal)} do total</p>
                      {d.pctOfPrevious !== null && (
                        <p className="text-gray-600">{formatPct(d.pctOfPrevious)} vs. estado anterior</p>
                      )}
                    </div>
                  )
                }} />
                <Bar dataKey="value" name="Leads" radius={[0, 4, 4, 0]} maxBarSize={22} label={renderPipelineLabel}>
                  {pipelineData.map((entry, i) => (
                    <Cell key={i} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-gray-700">Fontes de Leads</CardTitle>
            <p className="text-xs text-gray-400">Volume × taxa de vitória</p>
          </CardHeader>
          <CardContent className="flex items-center justify-center">
            {hasSourceData ? (
              <div className="flex items-center gap-4 w-full">
                <ResponsiveContainer width={160} height={160}>
                  <PieChart>
                    <Pie
                      data={sourceData}
                      dataKey="count"
                      nameKey="source"
                      cx="50%"
                      cy="50%"
                      innerRadius={45}
                      outerRadius={70}
                      paddingAngle={3}
                    >
                      {sourceData.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip content={({ active, payload }) => {
                      if (!active || !payload?.length) return null
                      const d = payload[0].payload as AnalyticsChartsData['sourceData'][number]
                      return (
                        <div className="bg-white border border-gray-200 rounded-lg shadow px-3 py-1.5 text-xs">
                          <p className="font-medium">{d.source}: {d.count}</p>
                          <p className="text-gray-500">Ganhas: {d.won}/{d.count} ({d.winRate.toFixed(0)}%)</p>
                        </div>
                      )
                    }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex-1 space-y-2">
                  {sourceData.map((s, i) => (
                    <div key={s.source} className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                      <span className="text-xs text-gray-600 truncate flex-1">{s.source}</span>
                      <span className="text-xs font-semibold text-gray-700">{s.count}</span>
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                        {s.winRate.toFixed(0)}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-400 py-8">Sem dados de fontes ainda</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Row 3: Agent activity (conditional) */}
      {hasAgentData && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-gray-700">Actividade dos Agentes IA</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={140}>
              <BarChart data={agentData} margin={{ top: 5, right: 20, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="runs" name="Execuções" fill="#6366f1" radius={[4, 4, 0, 0]} maxBarSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
