'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { LEAD_PIPELINE_ORDER, LEAD_STATUS_LABELS, LEAD_STATUS_COLORS, type LeadStatus } from '@/lib/types'
import { formatRelativeTime } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Flame, Trophy, X } from 'lucide-react'

export interface PipelineLead {
  id: string
  full_name: string
  phone: string | null
  email: string | null
  status: LeadStatus
  score: number
  urgency: number
  deal_value: number | null
  commission_value: number | null
  closed_at: string | null
  last_contact_at: string | null
  next_action_at: string | null
  created_at: string
  summary: string | null
}

interface Props {
  grouped: Record<LeadStatus, PipelineLead[]>
  totals: Record<LeadStatus, number>
  canEdit: boolean
}

const COMMISSION_DEFAULT_RATE = 0.04

function fmtEurCompact(v: number): string {
  if (v >= 1000) {
    const k = v / 1000
    return `${k.toFixed(k >= 10 ? 0 : 1)}k €`
  }
  return `${Math.round(v)} €`
}

function leadValueEur(l: PipelineLead): number | null {
  if (l.commission_value != null) return l.commission_value
  if (l.deal_value != null) return l.deal_value * COMMISSION_DEFAULT_RATE
  return null
}

const STATUS_BORDER: Record<LeadStatus, string> = {
  new: 'border-t-blue-400',
  qualified: 'border-t-purple-400',
  meeting: 'border-t-yellow-400',
  active: 'border-t-green-400',
  won: 'border-t-emerald-500',
  lost: 'border-t-red-400',
}

export function PipelineBoard({ grouped, totals, canEdit }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [boardState, setBoardState] = useState(grouped)
  const [totalsState, setTotalsState] = useState(totals)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [hoverCol, setHoverCol] = useState<LeadStatus | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)

  function recomputeTotals(state: Record<LeadStatus, PipelineLead[]>) {
    const next: Record<LeadStatus, number> = {
      new: 0, qualified: 0, meeting: 0, active: 0, won: 0, lost: 0,
    }
    for (const status of LEAD_PIPELINE_ORDER) {
      next[status] = state[status].reduce((s, l) => {
        const v = leadValueEur(l)
        return v == null ? s : s + v
      }, 0)
    }
    return next
  }

  async function moveLead(leadId: string, fromStatus: LeadStatus, toStatus: LeadStatus) {
    if (fromStatus === toStatus) return
    if (!canEdit) {
      toast.error('Sem permissoes para alterar leads.')
      return
    }

    const lead = boardState[fromStatus].find((l) => l.id === leadId)
    if (!lead) return

    // Optimistic update
    const updatedLead: PipelineLead = { ...lead, status: toStatus }
    const optimistic: Record<LeadStatus, PipelineLead[]> = {
      ...boardState,
      [fromStatus]: boardState[fromStatus].filter((l) => l.id !== leadId),
      [toStatus]: [updatedLead, ...boardState[toStatus]],
    }
    setBoardState(optimistic)
    setTotalsState(recomputeTotals(optimistic))
    setSavingId(leadId)

    try {
      const res = await fetch(`/api/leads/${leadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: toStatus }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => null)
        throw new Error(j?.error || 'Falha a guardar')
      }
      toast.success(`${lead.full_name} -> ${LEAD_STATUS_LABELS[toStatus]}`)
      // Refresca dados do servidor para apanhar mudancas (e.g. closed_at quando vai para won)
      startTransition(() => router.refresh())
    } catch (err) {
      // Rollback
      const rollback: Record<LeadStatus, PipelineLead[]> = {
        ...boardState,
        [fromStatus]: [lead, ...boardState[fromStatus].filter((l) => l.id !== leadId)],
        [toStatus]: boardState[toStatus].filter((l) => l.id !== leadId),
      }
      setBoardState(rollback)
      setTotalsState(recomputeTotals(rollback))
      const msg = err instanceof Error ? err.message : 'Erro desconhecido'
      toast.error(`Nao foi possivel mover: ${msg}`)
    } finally {
      setSavingId(null)
    }
  }

  function handleDragStart(e: React.DragEvent<HTMLDivElement>, leadId: string) {
    if (!canEdit) {
      e.preventDefault()
      return
    }
    setDraggingId(leadId)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', leadId)
  }

  function handleDragEnd() {
    setDraggingId(null)
    setHoverCol(null)
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>, status: LeadStatus) {
    if (!canEdit) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (hoverCol !== status) setHoverCol(status)
  }

  function handleDragLeave(status: LeadStatus) {
    if (hoverCol === status) setHoverCol(null)
  }

  async function handleDrop(e: React.DragEvent<HTMLDivElement>, toStatus: LeadStatus) {
    if (!canEdit) return
    e.preventDefault()
    const leadId = e.dataTransfer.getData('text/plain')
    setHoverCol(null)
    setDraggingId(null)
    if (!leadId) return

    const fromStatus = (Object.keys(boardState) as LeadStatus[]).find((s) =>
      boardState[s].some((l) => l.id === leadId)
    )
    if (!fromStatus) return
    await moveLead(leadId, fromStatus, toStatus)
  }

  return (
    <div className="overflow-x-auto pb-4">
      <div className="flex gap-3 min-w-max">
        {LEAD_PIPELINE_ORDER.map((status) => {
          const leads = boardState[status]
          const total = totalsState[status]
          const isHover = hoverCol === status
          return (
            <div
              key={status}
              className={`w-72 flex-shrink-0 bg-gray-50 rounded-lg border-t-4 ${STATUS_BORDER[status]} ${
                isHover ? 'ring-2 ring-blue-300 bg-blue-50' : ''
              }`}
              onDragOver={(e) => handleDragOver(e, status)}
              onDragLeave={() => handleDragLeave(status)}
              onDrop={(e) => handleDrop(e, status)}
            >
              <div className="px-3 pt-3 pb-2 sticky top-0 bg-inherit rounded-t-lg">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-semibold text-sm text-gray-800 truncate">
                      {LEAD_STATUS_LABELS[status]}
                    </span>
                    <Badge variant="outline" className="text-xs flex-shrink-0">
                      {leads.length}
                    </Badge>
                  </div>
                  {total > 0 && (
                    <span
                      className={`text-xs font-semibold tabular-nums flex-shrink-0 ${
                        status === 'won' ? 'text-emerald-700' : 'text-gray-600'
                      }`}
                      title={`${Math.round(total)} €`}
                    >
                      {fmtEurCompact(total)}
                    </span>
                  )}
                </div>
              </div>

              <div className="px-2 pb-2 space-y-2 min-h-[120px]">
                {leads.length === 0 && (
                  <div className="text-center py-8 border-2 border-dashed border-gray-200 rounded-lg mx-1">
                    <p className="text-xs text-gray-400">
                      {isHover ? 'Larga aqui' : 'Sem leads'}
                    </p>
                  </div>
                )}

                {leads.map((lead) => {
                  const value = leadValueEur(lead)
                  const valueIsEstimate = lead.commission_value == null && lead.deal_value != null
                  const isDragging = draggingId === lead.id
                  const isSaving = savingId === lead.id
                  const initials = lead.full_name
                    .split(' ')
                    .slice(0, 2)
                    .map((n) => n[0])
                    .join('')
                    .toUpperCase()

                  return (
                    <div
                      key={lead.id}
                      draggable={canEdit}
                      onDragStart={(e) => handleDragStart(e, lead.id)}
                      onDragEnd={handleDragEnd}
                      className={`bg-white border border-gray-200 rounded-lg p-3 transition-all ${
                        canEdit ? 'cursor-grab active:cursor-grabbing hover:shadow-md' : 'cursor-default'
                      } ${isDragging ? 'opacity-40' : ''} ${isSaving ? 'opacity-60 pointer-events-none' : ''}`}
                    >
                      <div className="flex items-start gap-2 mb-2">
                        <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center text-xs font-bold text-blue-600 flex-shrink-0">
                          {initials || '?'}
                        </div>
                        <Link
                          href={`/dashboard/leads/${lead.id}`}
                          className="font-medium text-sm text-gray-900 hover:text-blue-600 truncate flex-1 min-w-0"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {lead.full_name}
                        </Link>
                        {status === 'won' && <Trophy size={14} className="text-emerald-500 flex-shrink-0" />}
                        {status === 'lost' && <X size={14} className="text-red-400 flex-shrink-0" />}
                      </div>

                      {lead.summary && (
                        <p className="text-xs text-gray-500 line-clamp-2 mb-2">{lead.summary}</p>
                      )}

                      <div className="flex items-center justify-between text-xs text-gray-500 gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="tabular-nums">
                            <span className="text-gray-400">Score</span>{' '}
                            <strong className="text-gray-700">{lead.score}</strong>
                          </span>
                          {lead.urgency >= 4 && (
                            <span className="flex items-center gap-0.5 text-red-500">
                              <Flame size={11} />
                              <span className="text-[10px] font-semibold">{lead.urgency}</span>
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-gray-400 truncate">
                          {formatRelativeTime(lead.last_contact_at ?? lead.created_at)}
                        </span>
                      </div>

                      {value != null && (
                        <div
                          className={`mt-2 pt-2 border-t border-gray-100 text-xs font-semibold tabular-nums ${
                            status === 'won' ? 'text-emerald-700' : 'text-gray-700'
                          }`}
                          title={
                            valueIsEstimate
                              ? `Estimativa: ${(COMMISSION_DEFAULT_RATE * 100).toFixed(0)}% de ${Math.round(lead.deal_value!)} €`
                              : `Comissao: ${Math.round(lead.commission_value!)} €`
                          }
                        >
                          {fmtEurCompact(value)}
                          {valueIsEstimate && <span className="text-gray-400 font-normal ml-1">(est.)</span>}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {!canEdit && (
        <p className="text-xs text-gray-400 mt-3 text-center">
          Tens permissao apenas de leitura. Nao podes mover leads entre colunas.
        </p>
      )}
    </div>
  )
}
