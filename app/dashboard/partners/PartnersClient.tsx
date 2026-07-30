'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { Plus, Phone, Mail, Pencil, Trash2, Loader2, Users } from 'lucide-react'
import { PARTNER_CATEGORY_LABELS, PARTNER_CATEGORY_ORDER, type Partner, type PartnerCategory } from '@/lib/types'

interface Props {
  initialPartners: Partner[]
  canEdit: boolean
}

interface FormState {
  id: string | null
  name: string
  category: PartnerCategory
  phone: string
  email: string
  notes: string
}

const EMPTY_FORM: FormState = { id: null, name: '', category: 'credito', phone: '', email: '', notes: '' }

export function PartnersClient({ initialPartners, canEdit }: Props) {
  const [partners, setPartners] = useState(initialPartners)
  const [categoryFilter, setCategoryFilter] = useState<PartnerCategory | 'all'>('all')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const visible = categoryFilter === 'all'
    ? partners
    : partners.filter((p) => p.category === categoryFilter)

  function openCreate() {
    setForm(EMPTY_FORM)
    setDialogOpen(true)
  }

  function openEdit(p: Partner) {
    setForm({
      id: p.id,
      name: p.name,
      category: p.category,
      phone: p.phone ?? '',
      email: p.email ?? '',
      notes: p.notes ?? '',
    })
    setDialogOpen(true)
  }

  async function handleSave() {
    if (!form.name.trim()) {
      toast.error('Adiciona um nome')
      return
    }
    setSaving(true)
    try {
      const payload = {
        name: form.name.trim(),
        category: form.category,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        notes: form.notes.trim() || null,
      }
      const res = form.id
        ? await fetch(`/api/partners/${form.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
        : await fetch('/api/partners', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })

      if (!res.ok) {
        const err = await res.json().catch(() => null)
        toast.error(err?.error ?? 'Erro ao guardar')
        return
      }
      const saved: Partner = await res.json()
      setPartners((prev) =>
        form.id ? prev.map((p) => (p.id === saved.id ? saved : p)) : [...prev, saved].sort((a, b) => a.name.localeCompare(b.name))
      )
      toast.success(form.id ? 'Parceiro atualizado' : 'Parceiro adicionado')
      setDialogOpen(false)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id)
    try {
      const res = await fetch(`/api/partners/${id}`, { method: 'DELETE' })
      if (res.ok) {
        setPartners((prev) => prev.filter((p) => p.id !== id))
        toast.success('Parceiro removido')
      } else {
        toast.error('Erro ao remover')
      }
    } finally {
      setDeletingId(null)
    }
  }

  const categoriesInUse = PARTNER_CATEGORY_ORDER.filter((c) => partners.some((p) => p.category === c))

  return (
    <>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-2 flex-wrap">
          <Badge
            variant={categoryFilter === 'all' ? 'default' : 'outline'}
            className="cursor-pointer text-sm px-3 py-1"
            onClick={() => setCategoryFilter('all')}
          >
            Todos ({partners.length})
          </Badge>
          {categoriesInUse.map((c) => (
            <Badge
              key={c}
              variant={categoryFilter === c ? 'default' : 'outline'}
              className="cursor-pointer text-sm px-3 py-1"
              onClick={() => setCategoryFilter(c)}
            >
              {PARTNER_CATEGORY_LABELS[c]}
            </Badge>
          ))}
        </div>

        {canEdit && (
          <Button onClick={openCreate} className="gap-2 cursor-pointer">
            <Plus size={16} />
            Novo Parceiro
          </Button>
        )}
      </div>

      {visible.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <Users size={40} className="mx-auto mb-3 text-gray-300" />
          <p className="text-lg font-medium">Sem parceiros ainda</p>
          <p className="text-sm mt-1 text-gray-500">Adiciona intermediários de crédito, advogado, empreiteiros...</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {visible.map((p) => (
            <Card key={p.id} className="h-full">
              <CardContent className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="font-semibold text-gray-900 truncate">{p.name}</h3>
                    <Badge variant="outline" className="text-xs mt-1">
                      {PARTNER_CATEGORY_LABELS[p.category]}
                    </Badge>
                  </div>
                  {canEdit && (
                    <div className="flex gap-1 flex-shrink-0">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(p)}>
                        <Pencil size={13} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-gray-400 hover:text-red-600"
                        onClick={() => handleDelete(p.id)}
                        disabled={deletingId === p.id}
                      >
                        {deletingId === p.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                      </Button>
                    </div>
                  )}
                </div>

                {p.phone && (
                  <a
                    href={`tel:${p.phone}`}
                    className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-blue-600"
                  >
                    <Phone size={13} className="text-gray-400" />
                    {p.phone}
                  </a>
                )}
                {p.email && (
                  <a
                    href={`mailto:${p.email}`}
                    className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-blue-600 truncate"
                  >
                    <Mail size={13} className="text-gray-400 flex-shrink-0" />
                    <span className="truncate">{p.email}</span>
                  </a>
                )}
                {p.notes && <p className="text-xs text-gray-500 line-clamp-2 pt-1">{p.notes}</p>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{form.id ? 'Editar Parceiro' : 'Novo Parceiro'}</DialogTitle>
            <DialogDescription>Contacto de confiança para referenciar a clientes.</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Nome</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ex: João Silva" />
            </div>

            <div className="space-y-1.5">
              <Label>Categoria</Label>
              <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v as PartnerCategory })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PARTNER_CATEGORY_ORDER.map((c) => (
                    <SelectItem key={c} value={c}>
                      {PARTNER_CATEGORY_LABELS[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Telefone</Label>
                <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="9XX XXX XXX" />
              </div>
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="email@exemplo.pt" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Notas</Label>
              <Textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Ex: já trabalhámos juntos em 3 negócios, resposta rápida..."
                rows={3}
              />
            </div>

            <div className="flex gap-3 pt-2">
              <Button onClick={handleSave} disabled={saving} className="flex-1 gap-2">
                {saving && <Loader2 size={14} className="animate-spin" />}
                {form.id ? 'Guardar' : 'Adicionar'}
              </Button>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
