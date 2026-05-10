'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  LEAD_STATUS_LABELS,
  LEAD_STATUS_COLORS,
  LEAD_TYPE_LABELS,
  LEAD_TYPE_COLORS,
  type LeadStatus,
  type LeadType,
} from '@/lib/types'
import { buildWaLink, buildMailtoLink } from '@/lib/contact-links'
import { toast } from 'sonner'
import { Sparkles, Send, Mail, RefreshCw, Loader2, Check, ChevronRight } from 'lucide-react'

export interface ColdLead {
  id: string
  full_name: string
  phone: string | null
  email: string | null
  status: LeadStatus
  lead_type: LeadType
  score: number
  urgency: number
  last_contact_at: string | null
  created_at: string
  summary: string | null
  daysIdle: number
}

interface Props {
  leads: ColdLead[]
  minDays: number
  statusFilter: string | null
}

const DAYS_FILTERS = [
  { value: 14, label: '14+ dias' },
  { value: 30, label: '30+ dias' },
  { value: 60, label: '60+ dias' },
]

const STATUS_FILTERS: Array<{ value: 'all' | LeadStatus; label: string }> = [
  { value: 'all', label: 'Todos' },
  { value: 'qualified', label: 'Qualificada' },
  { value: 'meeting', label: 'Reuniao' },
  { value: 'active', label: 'Activa' },
]

export function ColdLeadsClient({ leads, minDays, statusFilter }: Props) {
  const router = useRouter()
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [generating, setGenerating] = useState<Set<string>>(new Set())
  const [sentSet, setSentSet] = useState<Set<string>>(new Set())
  const [marking, setMarking] = useState<Set<string>>(new Set())

  function applyFilter(daysVal?: number, statusVal?: 'all' | LeadStatus) {
    const params = new URLSearchParams()
    const d = daysVal ?? minDays
    if (d !== 14) params.set('days', String(d))
    const s = statusVal ?? statusFilter ?? 'all'
    if (s && s !== 'all') params.set('status', s)
    const qs = params.toString()
    router.push(`/dashboard/cold-leads${qs ? '?' + qs : ''}`)
  }

  async function generate(leadId: string) {
    setGenerating((s) => new Set(s).add(leadId))
    try {
      const res = await fetch('/api/cold-leads/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_id: leadId }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? 'Erro a gerar')
        return
      }
      setDrafts((d) => ({ ...d, [leadId]: data.body }))
    } catch {
      toast.error('Erro de ligacao')
    } finally {
      setGenerating((s) => {
        const n = new Set(s)
        n.delete(leadId)
        return n
      })
    }
  }

  async function markContacted(leadId: string, channel: 'whatsapp' | 'email' | 'call', body?: string) {
    setMarking((s) => new Set(s).add(leadId))
    try {
      const res = await fetch('/api/cold-leads/mark-contacted', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lead_id: leadId,
          channel,
          summary: body ? `Re-engagement: ${body.slice(0, 200)}` : undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? 'Erro ao marcar')
        return
      }
      setSentSet((s) => new Set(s).add(leadId))
      toast.success('Lead marcada como contactada')
    } catch {
      toast.error('Erro de ligacao')
    } finally {
      setMarking((s) => {
        const n = new Set(s)
        n.delete(leadId)
        return n
      })
    }
  }

  const hasActiveFilter = minDays !== 14 || (statusFilter && statusFilter !== 'all')

  return (
    <>
      {/* Filtros — sempre visiveis, mesmo quando lista vazia, para o user poder mudar */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 md:mx-0 md:px-0 md:flex-wrap items-center">
        <span className="text-xs text-gray-400 flex-shrink-0">Frias:</span>
        {DAYS_FILTERS.map((f) => (
          <Badge
            key={f.value}
            variant={minDays === f.value ? 'default' : 'outline'}
            onClick={() => applyFilter(f.value)}
            className="cursor-pointer text-xs px-2.5 py-1 flex-shrink-0 whitespace-nowrap"
          >
            {f.label}
          </Badge>
        ))}
        <span className="text-xs text-gray-400 flex-shrink-0 mx-1">|</span>
        <span className="text-xs text-gray-400 flex-shrink-0">Status:</span>
        {STATUS_FILTERS.map((f) => (
          <Badge
            key={f.value}
            variant={(statusFilter ?? 'all') === f.value ? 'default' : 'outline'}
            onClick={() => applyFilter(undefined, f.value)}
            className="cursor-pointer text-xs px-2.5 py-1 flex-shrink-0 whitespace-nowrap"
          >
            {f.label}
          </Badge>
        ))}
        {hasActiveFilter && (
          <Badge
            variant="outline"
            onClick={() => router.push('/dashboard/cold-leads')}
            className="cursor-pointer text-xs px-2.5 py-1 flex-shrink-0 whitespace-nowrap text-gray-500 border-gray-300 ml-1"
            title="Limpar filtros"
          >
            ✕ Limpar
          </Badge>
        )}
      </div>

      {leads.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-gray-400">
            <p className="text-base font-medium">Sem leads frias com este filtro</p>
            <p className="text-xs mt-1">
              Bom trabalho! Tenta um intervalo maior ou{' '}
              <button
                onClick={() => router.push('/dashboard/cold-leads')}
                className="text-blue-600 hover:underline"
              >
                limpar filtros
              </button>{' '}
              se queres ver leads dormentes.
            </p>
          </CardContent>
        </Card>
      ) : (
      <div className="space-y-3">
        {leads.map((lead) => {
          const draft = drafts[lead.id]
          const isGenerating = generating.has(lead.id)
          const isMarking = marking.has(lead.id)
          const wasMarked = sentSet.has(lead.id)
          const waLink = draft ? buildWaLink(lead.phone, draft) : null
          const mailto = draft ? buildMailtoLink(lead.email, `Voltar a falar — ${lead.full_name}`, draft) : null

          return (
            <Card key={lead.id} className={wasMarked ? 'opacity-60' : ''}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link href={`/dashboard/leads/${lead.id}`} className="font-semibold text-gray-900 hover:text-blue-600">
                        {lead.full_name}
                      </Link>
                      <Badge className={`text-xs ${LEAD_STATUS_COLORS[lead.status]}`}>
                        {LEAD_STATUS_LABELS[lead.status]}
                      </Badge>
                      <Badge className={`text-xs ${LEAD_TYPE_COLORS[lead.lead_type]}`}>
                        {LEAD_TYPE_LABELS[lead.lead_type]}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-500 mt-1 flex-wrap">
                      <span className="text-red-500 font-medium">{lead.daysIdle} dias frio</span>
                      <span>Score {lead.score}</span>
                      {lead.urgency >= 4 && <span className="text-orange-600">Urg {lead.urgency}/5</span>}
                      {lead.phone && <span className="truncate">{lead.phone}</span>}
                    </div>
                    {lead.summary && (
                      <p className="text-xs text-gray-600 mt-1.5 line-clamp-2">{lead.summary}</p>
                    )}
                  </div>
                  <Link
                    href={`/dashboard/leads/${lead.id}`}
                    className="text-xs text-blue-600 hover:text-blue-800 inline-flex items-center gap-0.5 flex-shrink-0"
                  >
                    Ver lead <ChevronRight size={12} />
                  </Link>
                </div>

                {/* Draft area */}
                {draft ? (
                  <div className="space-y-2">
                    <Textarea
                      value={draft}
                      onChange={(e) => setDrafts((d) => ({ ...d, [lead.id]: e.target.value }))}
                      rows={3}
                      className="text-sm"
                    />
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs gap-1"
                        onClick={() => generate(lead.id)}
                        disabled={isGenerating}
                      >
                        {isGenerating ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                        Re-gerar
                      </Button>
                      <div className="flex gap-2 flex-wrap">
                        {waLink && (
                          <a href={waLink} target="_blank" rel="noopener noreferrer" onClick={() => markContacted(lead.id, 'whatsapp', draft)}>
                            <Button size="sm" className="h-7 text-xs gap-1 bg-green-600 hover:bg-green-700 text-white">
                              <Send size={12} />
                              WhatsApp
                            </Button>
                          </a>
                        )}
                        {mailto && (
                          <a href={mailto} onClick={() => markContacted(lead.id, 'email', draft)}>
                            <Button size="sm" variant="outline" className="h-7 text-xs gap-1">
                              <Mail size={12} />
                              Email
                            </Button>
                          </a>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs gap-1"
                          disabled={isMarking || wasMarked}
                          onClick={() => markContacted(lead.id, 'whatsapp', draft)}
                          title="Apenas marcar como contactada (sem abrir nada)"
                        >
                          {wasMarked ? <Check size={12} className="text-green-500" /> : isMarking ? <Loader2 size={12} className="animate-spin" /> : null}
                          {wasMarked ? 'Contactada' : 'Marcar'}
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 h-8"
                    onClick={() => generate(lead.id)}
                    disabled={isGenerating}
                  >
                    {isGenerating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                    Gerar mensagem com IA
                  </Button>
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
