'use client'

import { useState } from 'react'
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
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { Pencil, Loader2 } from 'lucide-react'

interface Props {
  leadId: string
  initialFullName: string
  initialPhone: string | null
  initialEmail: string | null
  initialDealValue?: number | null
  initialCommissionValue?: number | null
  initialClosedAt?: string | null
}

function toDateInput(iso: string | null | undefined): string {
  if (!iso) return ''
  try {
    return new Date(iso).toISOString().slice(0, 10)
  } catch {
    return ''
  }
}

export function EditLeadDetailsButton({
  leadId,
  initialFullName,
  initialPhone,
  initialEmail,
  initialDealValue = null,
  initialCommissionValue = null,
  initialClosedAt = null,
}: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [fullName, setFullName] = useState(initialFullName)
  const [phone, setPhone] = useState(initialPhone ?? '')
  const [email, setEmail] = useState(initialEmail ?? '')
  const [dealValue, setDealValue] = useState(
    initialDealValue != null ? String(initialDealValue) : ''
  )
  const [commissionValue, setCommissionValue] = useState(
    initialCommissionValue != null ? String(initialCommissionValue) : ''
  )
  const [closedAtDate, setClosedAtDate] = useState(toDateInput(initialClosedAt))

  function reset() {
    setFullName(initialFullName)
    setPhone(initialPhone ?? '')
    setEmail(initialEmail ?? '')
    setDealValue(initialDealValue != null ? String(initialDealValue) : '')
    setCommissionValue(initialCommissionValue != null ? String(initialCommissionValue) : '')
    setClosedAtDate(toDateInput(initialClosedAt))
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset()
    setOpen(next)
  }

  function parseEur(input: string): number | null | 'invalid' {
    const trimmed = input.trim().replace(/\s+/g, '').replace(/\./g, '').replace(',', '.')
    if (trimmed.length === 0) return null
    const n = Number(trimmed)
    if (!Number.isFinite(n) || n < 0) return 'invalid'
    return Math.round(n * 100) / 100
  }

  async function handleSave() {
    const trimmedName = fullName.trim()
    if (trimmedName.length === 0) {
      toast.error('O nome nao pode estar vazio')
      return
    }
    const trimmedEmail = email.trim()
    if (trimmedEmail.length > 0 && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmedEmail)) {
      toast.error('Email invalido')
      return
    }

    const dealParsed = parseEur(dealValue)
    if (dealParsed === 'invalid') {
      toast.error('Valor do imovel invalido')
      return
    }
    const commissionParsed = parseEur(commissionValue)
    if (commissionParsed === 'invalid') {
      toast.error('Comissao invalida')
      return
    }

    let closedIso: string | null = null
    if (closedAtDate) {
      const d = new Date(closedAtDate + 'T12:00:00')
      if (isNaN(d.getTime())) {
        toast.error('Data de fecho invalida')
        return
      }
      closedIso = d.toISOString()
    }

    const payload: Record<string, string | number | null> = {
      full_name: trimmedName,
      phone: phone.trim().length > 0 ? phone.trim() : null,
      email: trimmedEmail.length > 0 ? trimmedEmail : null,
      deal_value: dealParsed,
      commission_value: commissionParsed,
      closed_at: closedIso,
    }

    setSaving(true)
    try {
      const res = await fetch(`/api/leads/${leadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? 'Erro ao guardar')
        return
      }
      toast.success('Lead atualizada')
      setOpen(false)
      router.refresh()
    } catch {
      toast.error('Erro de ligacao')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={() => setOpen(true)}
        title="Editar nome, contacto e valor da deal"
      >
        <Pencil size={14} />
        Editar lead
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Editar lead</DialogTitle>
            <DialogDescription>
              Atualiza nome, contactos e valor da deal. Campos vazios em telefone, email,
              valor e data sao guardados como nulo.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="edit-full-name">Nome completo</Label>
              <Input
                id="edit-full-name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Ex: Maria Silva"
                autoFocus
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="edit-phone">Telefone</Label>
                <Input
                  id="edit-phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+351 912 345 678"
                  type="tel"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-email">Email</Label>
                <Input
                  id="edit-email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="lead@example.com"
                  type="email"
                />
              </div>
            </div>

            <div className="border-t border-gray-100 pt-4 space-y-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Tracking financeiro (preencher quando a deal fechar)
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="edit-deal">Valor do imovel (EUR)</Label>
                  <Input
                    id="edit-deal"
                    inputMode="decimal"
                    value={dealValue}
                    onChange={(e) => setDealValue(e.target.value)}
                    placeholder="180000"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-commission">Comissao (EUR)</Label>
                  <Input
                    id="edit-commission"
                    inputMode="decimal"
                    value={commissionValue}
                    onChange={(e) => setCommissionValue(e.target.value)}
                    placeholder="7200"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="edit-closed-at">Data de fecho</Label>
                <Input
                  id="edit-closed-at"
                  type="date"
                  value={closedAtDate}
                  onChange={(e) => setClosedAtDate(e.target.value)}
                />
                <p className="text-xs text-gray-400">
                  Usado para somar a comissao no KPI anual do dashboard.
                </p>
              </div>
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
                  A guardar...
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
