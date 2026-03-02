'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from 'sonner'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { LEAD_SOURCE_OPTIONS } from '@/lib/types'

const SOURCE_LABELS: Record<string, string> = {
  facebook_ads: 'Facebook Ads',
  google_ads: 'Google Ads',
  tiktok_ads: 'TikTok Ads',
  referral: 'Referência',
  website: 'Website',
  idealista: 'Idealista',
  imovirtual: 'Imovirtual',
  other: 'Outro',
}

export default function NewLeadPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    full_name: '',
    phone: '',
    email: '',
    source: '',
    notes: '',
  })

  function setValue(key: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.full_name.trim()) {
      toast.error('O nome é obrigatório')
      return
    }
    setLoading(true)

    const res = await fetch('/api/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: form.full_name.trim(),
        phone: form.phone.trim() || undefined,
        email: form.email.trim() || undefined,
        source: form.source || undefined,
        notes: form.notes.trim() || undefined,
      }),
    })

    const data = await res.json()

    if (!res.ok) {
      toast.error(data.error || 'Erro ao criar lead')
      setLoading(false)
      return
    }

    toast.success('Lead criada com sucesso!')
    router.push(`/dashboard/leads/${data.id}`)
  }

  return (
    <div className="p-6 max-w-xl mx-auto">
      <div className="mb-6">
        <Link href="/dashboard/leads" className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1 mb-4">
          <ArrowLeft size={14} />
          Voltar às leads
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">Nova Lead</h1>
        <p className="text-sm text-gray-500 mt-1">Adiciona um novo contacto ao CRM</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Informação de Contacto</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="full_name">Nome completo *</Label>
              <Input
                id="full_name"
                placeholder="Ana Maria Santos"
                value={form.full_name}
                onChange={(e) => setValue('full_name', e.target.value)}
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="phone">Telemóvel</Label>
                <Input
                  id="phone"
                  placeholder="+351 912 345 678"
                  value={form.phone}
                  onChange={(e) => setValue('phone', e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="ana@email.com"
                  value={form.email}
                  onChange={(e) => setValue('email', e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="source">Origem da lead</Label>
              <Select value={form.source} onValueChange={(v) => setValue('source', v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleciona a origem" />
                </SelectTrigger>
                <SelectContent>
                  {LEAD_SOURCE_OPTIONS.map((src) => (
                    <SelectItem key={src} value={src}>
                      {SOURCE_LABELS[src] ?? src}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notas iniciais</Label>
              <Textarea
                id="notes"
                placeholder="Breve descrição do que o cliente procura..."
                value={form.notes}
                onChange={(e) => setValue('notes', e.target.value)}
                rows={3}
              />
            </div>

            <div className="flex gap-3 pt-2">
              <Button type="submit" className="flex-1" disabled={loading}>
                {loading ? 'A criar...' : 'Criar Lead'}
              </Button>
              <Link href="/dashboard/leads">
                <Button type="button" variant="outline">Cancelar</Button>
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
