'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { Plus, Phone, MessageCircle, Mail, Home, FileText, Loader2, X } from 'lucide-react'
import type { InteractionType } from '@/lib/types'

interface Props {
  leadId: string
  leadName: string
}

interface QuickType {
  type: InteractionType
  label: string
  Icon: typeof Phone
  color: string
}

const QUICK_TYPES: QuickType[] = [
  { type: 'call',     label: 'Chamada',  Icon: Phone,         color: 'bg-blue-500'   },
  { type: 'whatsapp', label: 'WhatsApp', Icon: MessageCircle, color: 'bg-green-500'  },
  { type: 'email',    label: 'Email',    Icon: Mail,          color: 'bg-purple-500' },
  { type: 'meeting',  label: 'Visita',   Icon: Home,          color: 'bg-amber-500'  },
  { type: 'note',     label: 'Nota',     Icon: FileText,      color: 'bg-gray-500'   },
]

function toLocalIsoMinute(d: Date): string {
  const yr = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const da = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${yr}-${mo}-${da}T${hh}:${mm}`
}

export function QuickActionFab({ leadId, leadName }: Props) {
  const router = useRouter()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [activeType, setActiveType] = useState<QuickType | null>(null)
  const [summary, setSummary] = useState('')
  const [occurredAt, setOccurredAt] = useState(() => toLocalIsoMinute(new Date()))
  const [saving, setSaving] = useState(false)

  function openPicker() {
    setPickerOpen(true)
  }

  function selectType(t: QuickType) {
    setActiveType(t)
    setPickerOpen(false)
    setSummary('')
    setOccurredAt(toLocalIsoMinute(new Date()))
  }

  function closeAll() {
    setPickerOpen(false)
    setActiveType(null)
    setSummary('')
  }

  async function handleSave() {
    if (!activeType) return
    const trimmed = summary.trim()
    if (trimmed.length === 0 && activeType.type !== 'meeting') {
      toast.error('Adiciona um resumo curto da interaccao')
      return
    }

    let occurredIso: string | null = null
    try {
      const d = new Date(occurredAt)
      if (isNaN(d.getTime())) throw new Error('data invalida')
      occurredIso = d.toISOString()
    } catch {
      toast.error('Data/hora invalida')
      return
    }

    setSaving(true)
    try {
      const res = await fetch('/api/interactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lead_id: leadId,
          type: activeType.type,
          summary: trimmed || `Visita registada (${activeType.label})`,
          occurred_at: occurredIso,
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        toast.error(data?.error ?? 'Erro a registar')
        return
      }
      const bumped = data?._auto_bumped === 'qualified'
      toast.success(`${activeType.label} registado${bumped ? ' — lead passou a Qualificada' : ''}`)
      closeAll()
      router.refresh()
    } catch {
      toast.error('Erro de ligacao')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      {/* FAB — visivel em mobile (sm:hidden esconde em desktop). Em desktop usa-se o botao normal "Analisar Conversa" */}
      <button
        onClick={openPicker}
        aria-label="Registar interaccao rapida"
        title={`Registar interaccao com ${leadName}`}
        className="md:hidden fixed bottom-20 right-4 z-40 w-14 h-14 rounded-full bg-blue-600 text-white shadow-lg active:scale-95 transition-transform flex items-center justify-center"
      >
        <Plus size={28} strokeWidth={2.5} />
      </button>

      {/* Picker — escolha do tipo de interaccao */}
      <Dialog open={pickerOpen} onOpenChange={(v) => (!v ? closeAll() : setPickerOpen(v))}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Registar interaccao</DialogTitle>
            <DialogDescription>Toca no tipo de interaccao que tiveste com {leadName}.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-3 gap-3 py-2">
            {QUICK_TYPES.map((t) => {
              const Icon = t.Icon
              return (
                <button
                  key={t.type}
                  onClick={() => selectType(t)}
                  className="flex flex-col items-center gap-2 p-4 rounded-xl border border-gray-200 active:scale-95 transition-transform hover:bg-gray-50"
                >
                  <div className={`w-12 h-12 rounded-full ${t.color} text-white flex items-center justify-center`}>
                    <Icon size={22} />
                  </div>
                  <span className="text-xs font-medium text-gray-700">{t.label}</span>
                </button>
              )
            })}
          </div>
        </DialogContent>
      </Dialog>

      {/* Form — captura do resumo */}
      <Dialog open={activeType !== null} onOpenChange={(v) => (!v ? closeAll() : null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {activeType && <activeType.Icon size={18} />}
              {activeType?.label} — {leadName}
            </DialogTitle>
            <DialogDescription>Resumo curto do que se passou. Pode ser 1 linha.</DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="quick-summary">Resumo</Label>
              <Textarea
                id="quick-summary"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="Ex: Cliente confirmou interesse em T2 Bonfim, ate 200k. Vai pensar e responder ate sexta."
                rows={4}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="quick-occurred">Quando aconteceu</Label>
              <Input
                id="quick-occurred"
                type="datetime-local"
                value={occurredAt}
                onChange={(e) => setOccurredAt(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={closeAll} disabled={saving}>
              <X size={14} />
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving} className="gap-1.5">
              {saving ? (
                <>
                  <Loader2 size={14} className="animate-spin" /> A guardar...
                </>
              ) : (
                'Guardar'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
