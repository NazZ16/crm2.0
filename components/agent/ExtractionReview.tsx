'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Check, Copy, AlertTriangle, Lightbulb, MessageCircle, MessageSquarePlus, Loader2, X,
} from 'lucide-react'
import { DraftSendButtons } from '@/app/dashboard/leads/[id]/DraftSendButtons'
import type { AgentExtractionResult, AgentRecommendations, AgentDrafts } from '@/lib/types'

interface Props {
  leadPhone: string | null
  leadEmail: string | null
  leadUpdates: AgentExtractionResult
  recommendations: AgentRecommendations
  drafts: AgentDrafts
  extractionId: string | null
  onApplied?: () => void
  onDismissed?: () => void
}

export function ExtractionReview({
  leadPhone, leadEmail, leadUpdates, recommendations, drafts, extractionId, onApplied, onDismissed,
}: Props) {
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)
  const [dismissing, setDismissing] = useState(false)

  function copyText(text: string, id: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 2000)
      toast.success('Copiado!')
    })
  }

  async function handleApply() {
    if (!extractionId) return
    setApplying(true)
    try {
      const res = await fetch(`/api/agent-extractions/${extractionId}/apply`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? 'Erro ao aplicar')
        return
      }
      toast.success(
        data.tasksCreated > 0
          ? `Aplicado ao perfil — ${data.tasksCreated} tarefa(s) criada(s)`
          : 'Aplicado ao perfil'
      )
      onApplied?.()
    } finally {
      setApplying(false)
    }
  }

  async function handleDismiss() {
    if (!extractionId) return
    setDismissing(true)
    try {
      const res = await fetch(`/api/agent-extractions/${extractionId}/dismiss`, { method: 'POST' })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        toast.error(data?.error ?? 'Erro ao descartar')
        return
      }
      toast.success('Extração descartada')
      onDismissed?.()
    } finally {
      setDismissing(false)
    }
  }

  return (
    <div className="space-y-5">
      {/* Score & Urgency */}
      <div className="flex gap-4 p-4 bg-blue-50 rounded-lg">
        <div className="text-center">
          <div className="text-3xl font-bold text-blue-700">{leadUpdates.score}</div>
          <div className="text-xs text-blue-600">Score</div>
        </div>
        <div className="text-center">
          <div className="text-3xl font-bold text-orange-600">{leadUpdates.urgency}/5</div>
          <div className="text-xs text-orange-500">Urgência</div>
        </div>
        <div className="flex-1">
          <p className="text-sm text-gray-700 leading-relaxed">{leadUpdates.summary}</p>
        </div>
      </div>

      {/* Red Flags */}
      {recommendations.red_flags.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-red-600 flex items-center gap-1.5 mb-2">
            <AlertTriangle size={14} />
            Alertas
          </h4>
          <ul className="space-y-1">
            {recommendations.red_flags.map((flag, i) => (
              <li key={i} className="text-sm text-red-700 bg-red-50 px-3 py-1.5 rounded">
                {flag}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Next Actions */}
      {recommendations.next_best_actions.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5 mb-2">
            <Check size={14} />
            Próximas Ações (tarefas sugeridas — criadas ao aplicar)
          </h4>
          <div className="space-y-2">
            {recommendations.next_best_actions.map((action, i) => (
              <div key={i} className="p-3 bg-gray-50 rounded-lg">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-medium">{action.title}</span>
                  <Badge className={`text-xs ${
                    action.priority === 'high' ? 'bg-orange-100 text-orange-700' :
                    action.priority === 'medium' ? 'bg-blue-100 text-blue-700' :
                    'bg-gray-100 text-gray-600'
                  }`}>
                    {action.priority === 'high' ? 'Alta' : action.priority === 'medium' ? 'Média' : 'Baixa'}
                  </Badge>
                </div>
                <p className="text-xs text-gray-500">{action.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Coaching Notes */}
      {recommendations.coaching_notes.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-purple-700 flex items-center gap-1.5 mb-2">
            <Lightbulb size={14} />
            Dicas do Coach
          </h4>
          <ul className="space-y-1">
            {recommendations.coaching_notes.map((note, i) => (
              <li key={i} className="text-sm text-purple-700 bg-purple-50 px-3 py-1.5 rounded">
                {note}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Next Questions */}
      {recommendations.next_questions.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5 mb-2">
            <MessageCircle size={14} />
            Perguntas por Fazer
          </h4>
          <ul className="space-y-1">
            {recommendations.next_questions.map((q, i) => (
              <li key={i} className="text-sm text-gray-600 bg-gray-50 px-3 py-1.5 rounded">
                {q}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Message Drafts */}
      {drafts.drafts.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-green-700 flex items-center gap-1.5 mb-2">
            <MessageSquarePlus size={14} />
            Rascunhos de Mensagem
          </h4>
          <div className="space-y-3">
            {drafts.drafts.map((draft, i) => (
              <div key={i} className="border border-gray-200 rounded-lg overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b gap-2 flex-wrap">
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge variant="outline" className="text-xs flex-shrink-0">
                      {draft.channel === 'whatsapp' ? 'WhatsApp' : 'Email'}
                    </Badge>
                    <span className="text-xs text-gray-500 truncate">{draft.goal}</span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <DraftSendButtons
                      channel={draft.channel}
                      body={draft.body}
                      subject={draft.subject}
                      leadPhone={leadPhone}
                      leadEmail={leadEmail}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => copyText(draft.body, `draft-${i}`)}
                    >
                      {copiedId === `draft-${i}` ? (
                        <Check size={12} className="text-green-500" />
                      ) : (
                        <Copy size={12} />
                      )}
                    </Button>
                  </div>
                </div>
                {draft.subject && (
                  <div className="px-3 py-1.5 bg-blue-50 border-b text-xs font-medium text-blue-700">
                    Assunto: {draft.subject}
                  </div>
                )}
                <div className="p-3">
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{draft.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {extractionId && (
        <div className="flex gap-3 pt-2 border-t">
          <Button onClick={handleApply} disabled={applying || dismissing} className="flex-1 gap-2">
            {applying ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            Aplicar ao perfil
          </Button>
          <Button
            variant="outline"
            onClick={handleDismiss}
            disabled={applying || dismissing}
            className="gap-2 text-gray-500"
          >
            {dismissing ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
            Descartar
          </Button>
        </div>
      )}
    </div>
  )
}
