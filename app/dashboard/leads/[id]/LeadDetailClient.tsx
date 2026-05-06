'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import {
  MessageSquarePlus, Bot, ChevronDown, Copy, Check,
  AlertTriangle, Lightbulb, MessageCircle, User, Loader2, Trash2,
} from 'lucide-react'
import { LEAD_STATUS_LABELS, LEAD_PIPELINE_ORDER, CONVERSATION_OBJECTIVES, TASK_PRIORITY_LABELS } from '@/lib/types'
import type { LeadStatus, AgentFullOutput } from '@/lib/types'
import { MergeLeadsButton } from '../MergeLeadsButton'
import { DraftSendButtons } from './DraftSendButtons'

interface Props {
  leadId: string
  leadName: string
  leadPhone: string | null
  leadEmail: string | null
  currentStatus: LeadStatus
  canEdit: boolean
  isAdmin: boolean
}

export function LeadDetailClient({ leadId, leadName, leadPhone, leadEmail, currentStatus, canEdit, isAdmin }: Props) {
  const router = useRouter()
  const [status, setStatus] = useState<LeadStatus>(currentStatus)
  const [updatingStatus, setUpdatingStatus] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Conversation modal state
  const [modalOpen, setModalOpen] = useState(false)
  const [conversationText, setConversationText] = useState('')
  const [objective, setObjective] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [agentOutput, setAgentOutput] = useState<AgentFullOutput | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  async function handleStatusChange(newStatus: LeadStatus) {
    setUpdatingStatus(true)
    const res = await fetch(`/api/leads/${leadId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    })

    if (res.ok) {
      setStatus(newStatus)
      toast.success(`Status atualizado para ${LEAD_STATUS_LABELS[newStatus]}`)
      router.refresh()
    } else {
      toast.error('Erro ao atualizar status')
    }
    setUpdatingStatus(false)
  }

  async function handleAnalyze() {
    if (!conversationText.trim()) {
      toast.error('Adiciona o texto da conversa')
      return
    }
    if (!objective) {
      toast.error('Seleciona o objetivo da análise')
      return
    }

    setAnalyzing(true)
    setAgentOutput(null)

    try {
      const res = await fetch('/api/agents/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lead_id: leadId,
          conversation_text: conversationText,
          objective,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        toast.error(data.error || 'Erro na análise')
        return
      }

      setAgentOutput(data as AgentFullOutput)
      toast.success('Análise concluída!')
      router.refresh()
    } catch {
      toast.error('Erro de conexão')
    } finally {
      setAnalyzing(false)
    }
  }

  function copyText(text: string, id: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 2000)
      toast.success('Copiado!')
    })
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      const res = await fetch(`/api/leads/${leadId}`, { method: 'DELETE' })
      if (res.ok) {
        toast.success('Lead eliminada')
        router.push('/dashboard/leads')
        router.refresh()
      } else {
        const data = await res.json()
        toast.error(data.error ?? 'Erro ao eliminar')
        setDeleteConfirm(false)
      }
    } catch {
      toast.error('Erro de ligação')
      setDeleteConfirm(false)
    } finally {
      setDeleting(false)
    }
  }

  function handleCloseModal() {
    setModalOpen(false)
    setConversationText('')
    setObjective('')
    setAgentOutput(null)
  }

  return (
    <>
      <div className="flex items-center gap-3 flex-wrap">
        {canEdit && (
          <Select value={status} onValueChange={(v) => handleStatusChange(v as LeadStatus)} disabled={updatingStatus}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LEAD_PIPELINE_ORDER.map((s) => (
                <SelectItem key={s} value={s}>
                  {LEAD_STATUS_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <Button onClick={() => setModalOpen(true)} className="gap-2">
          <MessageSquarePlus size={16} />
          Analisar Conversa
        </Button>

        <MergeLeadsButton leadId={leadId} leadName={leadName} isAdmin={isAdmin} />

        {isAdmin && !deleteConfirm && (
          <Button
            variant="ghost"
            size="icon"
            className="text-gray-400 hover:text-red-600 hover:bg-red-50"
            onClick={() => setDeleteConfirm(true)}
            title="Eliminar lead"
          >
            <Trash2 size={16} />
          </Button>
        )}

        {isAdmin && deleteConfirm && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-1.5">
            <span className="text-sm text-red-700">Eliminar <strong>{leadName}</strong>?</span>
            <Button
              size="sm"
              variant="destructive"
              className="h-7 text-xs gap-1"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
              Confirmar
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => setDeleteConfirm(false)}
              disabled={deleting}
            >
              Cancelar
            </Button>
          </div>
        )}
      </div>

      {/* Conversation Analysis Modal */}
      <Dialog open={modalOpen} onOpenChange={handleCloseModal}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bot size={18} className="text-blue-600" />
              Analisar Conversa — {leadName}
            </DialogTitle>
            <DialogDescription>
              Cola a conversa com o cliente. O agente IA irá extrair informações, dar recomendações e gerar rascunhos.
            </DialogDescription>
          </DialogHeader>

          {!agentOutput ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="objective">Objetivo da análise</Label>
                <Select value={objective} onValueChange={setObjective}>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleciona o objetivo..." />
                  </SelectTrigger>
                  <SelectContent>
                    {CONVERSATION_OBJECTIVES.map((obj) => (
                      <SelectItem key={obj.value} value={obj.value}>
                        {obj.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="conversation">Conversa (WhatsApp, chamada, email...)</Label>
                <Textarea
                  id="conversation"
                  placeholder="Cola aqui o texto da conversa...&#10;&#10;Ex:&#10;Cliente: Bom dia, vi o vosso anúncio...&#10;Eu: Olá! Muito obrigado pelo contacto..."
                  value={conversationText}
                  onChange={(e) => setConversationText(e.target.value)}
                  rows={10}
                  className="font-mono text-sm"
                />
                <p className="text-xs text-gray-400">{conversationText.length} caracteres</p>
              </div>

              <div className="flex gap-3">
                <Button onClick={handleAnalyze} disabled={analyzing} className="flex-1 gap-2">
                  {analyzing ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      A analisar...
                    </>
                  ) : (
                    <>
                      <Bot size={16} />
                      Analisar com IA
                    </>
                  )}
                </Button>
                <Button variant="outline" onClick={handleCloseModal}>Cancelar</Button>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              {/* Score & Urgency */}
              <div className="flex gap-4 p-4 bg-blue-50 rounded-lg">
                <div className="text-center">
                  <div className="text-3xl font-bold text-blue-700">{agentOutput.lead_updates.score}</div>
                  <div className="text-xs text-blue-600">Score</div>
                </div>
                <div className="text-center">
                  <div className="text-3xl font-bold text-orange-600">{agentOutput.lead_updates.urgency}/5</div>
                  <div className="text-xs text-orange-500">Urgência</div>
                </div>
                <div className="flex-1">
                  <p className="text-sm text-gray-700 leading-relaxed">{agentOutput.lead_updates.summary}</p>
                </div>
              </div>

              {/* Red Flags */}
              {agentOutput.recommendations.red_flags.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-red-600 flex items-center gap-1.5 mb-2">
                    <AlertTriangle size={14} />
                    Alertas
                  </h4>
                  <ul className="space-y-1">
                    {agentOutput.recommendations.red_flags.map((flag, i) => (
                      <li key={i} className="text-sm text-red-700 bg-red-50 px-3 py-1.5 rounded">
                        {flag}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Next Actions */}
              {agentOutput.recommendations.next_best_actions.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5 mb-2">
                    <Check size={14} />
                    Próximas Ações (tarefas criadas automaticamente)
                  </h4>
                  <div className="space-y-2">
                    {agentOutput.recommendations.next_best_actions.map((action, i) => (
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
              {agentOutput.recommendations.coaching_notes.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-purple-700 flex items-center gap-1.5 mb-2">
                    <Lightbulb size={14} />
                    Dicas do Coach
                  </h4>
                  <ul className="space-y-1">
                    {agentOutput.recommendations.coaching_notes.map((note, i) => (
                      <li key={i} className="text-sm text-purple-700 bg-purple-50 px-3 py-1.5 rounded">
                        {note}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Next Questions */}
              {agentOutput.recommendations.next_questions.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5 mb-2">
                    <MessageCircle size={14} />
                    Perguntas por Fazer
                  </h4>
                  <ul className="space-y-1">
                    {agentOutput.recommendations.next_questions.map((q, i) => (
                      <li key={i} className="text-sm text-gray-600 bg-gray-50 px-3 py-1.5 rounded">
                        {q}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Message Drafts */}
              {agentOutput.drafts.drafts.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-green-700 flex items-center gap-1.5 mb-2">
                    <MessageSquarePlus size={14} />
                    Rascunhos de Mensagem
                  </h4>
                  <div className="space-y-3">
                    {agentOutput.drafts.drafts.map((draft, i) => (
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

              <div className="flex gap-3 pt-2 border-t">
                <Button
                  variant="outline"
                  onClick={() => { setAgentOutput(null); setConversationText(''); }}
                  className="flex-1"
                >
                  Analisar outra conversa
                </Button>
                <Button onClick={handleCloseModal}>Fechar</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
