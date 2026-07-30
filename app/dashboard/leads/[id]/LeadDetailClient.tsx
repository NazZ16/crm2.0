'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import {
  MessageSquarePlus, Bot, Loader2, Trash2,
} from 'lucide-react'
import { LEAD_STATUS_LABELS, LEAD_PIPELINE_ORDER, CONVERSATION_OBJECTIVES } from '@/lib/types'
import type { LeadStatus, AgentFullOutput } from '@/lib/types'
import { MergeLeadsButton } from '../MergeLeadsButton'
import { ExtractionReview } from '@/components/agent/ExtractionReview'

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
  const [extractionId, setExtractionId] = useState<string | null>(null)

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
      setExtractionId((data as { extraction_id?: string }).extraction_id ?? null)
      toast.success('Análise concluída — revê e aplica ao perfil')
    } catch {
      toast.error('Erro de conexão')
    } finally {
      setAnalyzing(false)
    }
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
    setExtractionId(null)
  }

  function handleExtractionResolved() {
    handleCloseModal()
    router.refresh()
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
            <div className="space-y-3">
              <ExtractionReview
                leadPhone={leadPhone}
                leadEmail={leadEmail}
                leadUpdates={agentOutput.lead_updates}
                recommendations={agentOutput.recommendations}
                drafts={agentOutput.drafts}
                extractionId={extractionId}
                onApplied={handleExtractionResolved}
                onDismissed={handleExtractionResolved}
              />
              <div className="flex gap-3 pt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { setAgentOutput(null); setExtractionId(null); setConversationText('') }}
                  className="flex-1 text-gray-500"
                >
                  Analisar outra conversa
                </Button>
                <Button variant="ghost" size="sm" onClick={handleCloseModal} className="text-gray-400">
                  Fechar sem decidir agora
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
