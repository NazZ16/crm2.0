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
}

export function EditLeadDetailsButton({
  leadId,
  initialFullName,
  initialPhone,
  initialEmail,
}: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [fullName, setFullName] = useState(initialFullName)
  const [phone, setPhone] = useState(initialPhone ?? '')
  const [email, setEmail] = useState(initialEmail ?? '')

  function reset() {
    setFullName(initialFullName)
    setPhone(initialPhone ?? '')
    setEmail(initialEmail ?? '')
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset()
    setOpen(next)
  }

  async function handleSave() {
    const trimmedName = fullName.trim()
    if (trimmedName.length === 0) {
      toast.error('O nome nao pode estar vazio')
      return
    }

    const trimmedPhone = phone.trim()
    const trimmedEmail = email.trim()

    if (trimmedEmail.length > 0 && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmedEmail)) {
      toast.error('Email invalido')
      return
    }

    const payload: Record<string, string | null> = {
      full_name: trimmedName,
      phone: trimmedPhone.length > 0 ? trimmedPhone : null,
      email: trimmedEmail.length > 0 ? trimmedEmail : null,
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

      toast.success('Contacto atualizado')
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
        title="Editar nome, telefone e email"
      >
        <Pencil size={14} />
        Editar contacto
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Editar contacto da lead</DialogTitle>
            <DialogDescription>
              Atualiza nome, telefone e email. Campos vazios em telefone e email sao guardados como nulo.
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
