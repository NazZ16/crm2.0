'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { Plus, Loader2 } from 'lucide-react'

export interface LeadOption {
  id: string
  full_name: string
}

interface Props {
  /** Se passada, a tarefa fica fixa nessa lead e o seletor desaparece. */
  defaultLead?: LeadOption | null
  /** Lista de leads para o seletor (usado quando defaultLead nao e passada). */
  leads?: LeadOption[]
  /** Tamanho/variante do botao. */
  variant?: 'default' | 'outline' | 'ghost'
  size?: 'sm' | 'default'
  /** Texto custom do botao (default: "Nova tarefa"). */
  label?: string
}

function defaultDueAt(): string {
  // Hoje as 18:00 local
  const d = new Date()
  d.setHours(18, 0, 0, 0)
  // Formato datetime-local: YYYY-MM-DDTHH:MM
  const tzOffset = d.getTimezoneOffset() * 60_000
  const local = new Date(d.getTime() - tzOffset)
  return local.toISOString().slice(0, 16)
}

export function NewTaskButton({
  defaultLead = null,
  leads = [],
  variant = 'default',
  size = 'sm',
  label = 'Nova tarefa',
}: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<'low' | 'medium' | 'high' | 'urgent'>('medium')
  const [dueAt, setDueAt] = useState(defaultDueAt())
  const [leadId, setLeadId] = useState<string>(defaultLead?.id ?? '')
  const [leadFilter, setLeadFilter] = useState('')

  const filteredLeads = useMemo(() => {
    const q = leadFilter.trim().toLowerCase()
    if (q.length === 0) return leads.slice(0, 30)
    return leads.filter((l) => l.full_name.toLowerCase().includes(q)).slice(0, 30)
  }, [leadFilter, leads])

  function reset() {
    setTitle('')
    setDescription('')
    setPriority('medium')
    setDueAt(defaultDueAt())
    setLeadId(defaultLead?.id ?? '')
    setLeadFilter('')
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset()
    setOpen(next)
  }

  async function handleSave() {
    const trimmed = title.trim()
    if (trimmed.length === 0) {
      toast.error('Da um titulo a tarefa')
      return
    }
    const finalLeadId = defaultLead?.id ?? leadId
    if (!finalLeadId) {
      toast.error('Escolhe a lead a que esta tarefa pertence')
      return
    }

    // dueAt vem como "YYYY-MM-DDTHH:MM" (sem timezone). Converter para ISO UTC.
    let dueIso: string | undefined
    if (dueAt) {
      const d = new Date(dueAt)
      if (!isNaN(d.getTime())) dueIso = d.toISOString()
    }

    setSaving(true)
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: trimmed,
          description: description.trim().length > 0 ? description.trim() : undefined,
          priority,
          due_at: dueIso,
          lead_id: finalLeadId,
          created_by: 'me',
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? 'Erro ao criar tarefa')
        return
      }
      toast.success('Tarefa criada')
      setOpen(false)
      reset()
      router.refresh()
    } catch {
      toast.error('Erro de ligacao')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Button variant={variant} size={size} className="gap-1.5" onClick={() => setOpen(true)}>
        <Plus size={14} />
        {label}
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nova tarefa</DialogTitle>
            <DialogDescription>
              {defaultLead ? `Para a lead ${defaultLead.full_name}.` : 'Escolhe a lead a que esta tarefa pertence.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="task-title">Titulo</Label>
              <Input
                id="task-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ex: Visita ao T2 da Maria as 17h"
                autoFocus
              />
            </div>

            {!defaultLead && (
              <div className="space-y-1.5">
                <Label htmlFor="task-lead-filter">Lead</Label>
                <Input
                  id="task-lead-filter"
                  value={leadFilter}
                  onChange={(e) => setLeadFilter(e.target.value)}
                  placeholder="Procurar pelo nome..."
                />
                <Select value={leadId} onValueChange={setLeadId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleciona a lead" />
                  </SelectTrigger>
                  <SelectContent>
                    {filteredLeads.length === 0 ? (
                      <div className="px-2 py-1.5 text-sm text-gray-400">Sem leads</div>
                    ) : (
                      filteredLeads.map((l) => (
                        <SelectItem key={l.id} value={l.id}>
                          {l.full_name}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="task-priority">Prioridade</Label>
                <Select value={priority} onValueChange={(v) => setPriority(v as typeof priority)}>
                  <SelectTrigger id="task-priority">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Baixa</SelectItem>
                    <SelectItem value="medium">Media</SelectItem>
                    <SelectItem value="high">Alta</SelectItem>
                    <SelectItem value="urgent">Urgente</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="task-due">Prazo</Label>
                <Input
                  id="task-due"
                  type="datetime-local"
                  value={dueAt}
                  onChange={(e) => setDueAt(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="task-desc">Descricao (opcional)</Label>
              <Textarea
                id="task-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Detalhes, contexto, links..."
                rows={3}
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving} className="gap-1.5">
              {saving ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  A criar...
                </>
              ) : (
                'Criar tarefa'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
