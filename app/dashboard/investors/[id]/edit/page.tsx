'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { toast } from 'sonner'
import { ArrowLeft } from 'lucide-react'
import {
  INVESTMENT_TYPE_LABELS, RISK_LEVEL_LABELS,
  INVESTMENT_HORIZON_LABELS, MAX_RENOVATION_LABELS,
  type Investor, type InvestmentType,
} from '@/lib/types'

const INVESTMENT_TYPES: InvestmentType[] = ['buy_to_let', 'buy_to_sell', 'fix_and_flip', 'commercial']
const PORTUGUESE_ZONES = [
  'Lisboa', 'Porto', 'Cascais', 'Sintra', 'Oeiras', 'Setúbal', 'Almada',
  'Braga', 'Coimbra', 'Aveiro', 'Funchal', 'Faro', 'Évora', 'Leiria',
]

export default function EditInvestorPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [fetching, setFetching] = useState(true)
  const [loading, setLoading] = useState(false)

  const [form, setForm] = useState({
    name: '', email: '', phone: '', budget_min: '', budget_max: '',
    min_yield: '', risk_level: 'moderate', investment_horizon: 'medium',
    needs_financing: false, max_renovation: 'light', notes: '',
  })
  const [selectedTypes, setSelectedTypes] = useState<InvestmentType[]>([])
  const [selectedZones, setSelectedZones] = useState<string[]>([])
  const [selectedTypologies, setSelectedTypologies] = useState<string[]>([])
  const [customZone, setCustomZone] = useState('')

  const loadInvestor = useCallback(async () => {
    const res = await fetch(`/api/investors/${id}`)
    if (!res.ok) { router.push('/dashboard/investors'); return }
    const inv: Investor = await res.json()
    setForm({
      name: inv.name ?? '',
      email: inv.email ?? '',
      phone: inv.phone ?? '',
      budget_min: inv.budget_min ? String(inv.budget_min) : '',
      budget_max: inv.budget_max ? String(inv.budget_max) : '',
      min_yield: inv.min_yield ? String(inv.min_yield) : '',
      risk_level: inv.risk_level ?? 'moderate',
      investment_horizon: inv.investment_horizon ?? 'medium',
      needs_financing: inv.needs_financing ?? false,
      max_renovation: inv.max_renovation ?? 'light',
      notes: inv.notes ?? '',
    })
    setSelectedTypes((inv.investment_type ?? []) as InvestmentType[])
    setSelectedZones(inv.preferred_zones ?? [])
    setSelectedTypologies(inv.preferred_typologies ?? [])
    setFetching(false)
  }, [id, router])

  useEffect(() => { loadInvestor() }, [loadInvestor])

  function toggleType(t: InvestmentType) {
    setSelectedTypes((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t])
  }
  function toggleTypology(t: string) {
    setSelectedTypologies((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t])
  }
  function toggleZone(z: string) {
    setSelectedZones((prev) => prev.includes(z) ? prev.filter((x) => x !== z) : [...prev, z])
  }
  function addCustomZone() {
    const z = customZone.trim()
    if (z && !selectedZones.includes(z)) { setSelectedZones((prev) => [...prev, z]); setCustomZone('') }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) { toast.error('O nome é obrigatório'); return }
    setLoading(true)

    const res = await fetch(`/api/investors/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.name.trim(),
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        investment_type: selectedTypes,
        budget_min: form.budget_min ? parseInt(form.budget_min) : null,
        budget_max: form.budget_max ? parseInt(form.budget_max) : null,
        preferred_zones: selectedZones,
        preferred_typologies: selectedTypologies,
        min_yield: form.min_yield ? parseFloat(form.min_yield) : null,
        risk_level: form.risk_level,
        investment_horizon: form.investment_horizon,
        needs_financing: form.needs_financing,
        max_renovation: form.max_renovation,
        notes: form.notes.trim() || null,
      }),
    })

    const data = await res.json()
    if (!res.ok) { toast.error(data.error || 'Erro ao guardar'); setLoading(false); return }
    toast.success('Investidor atualizado!')
    router.push(`/dashboard/investors/${id}`)
  }

  if (fetching) return <div className="p-6 text-center text-gray-400">A carregar...</div>

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-6">
        <Link href={`/dashboard/investors/${id}`} className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1 mb-4">
          <ArrowLeft size={14} /> Voltar ao investidor
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">Editar Investidor</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Contacto</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="name">Nome *</Label>
              <Input id="name" placeholder="João Ferreira" value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} required />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="phone">Telemóvel</Label>
                <Input id="phone" placeholder="+351 912 345 678" value={form.phone}
                  onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" placeholder="joao@email.com" value={form.email}
                  onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Perfil de Investimento</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Tipo de investimento</Label>
              <div className="grid grid-cols-2 gap-2">
                {INVESTMENT_TYPES.map((t) => (
                  <label key={t} className="flex items-center gap-2 cursor-pointer">
                    <Checkbox checked={selectedTypes.includes(t)} onCheckedChange={() => toggleType(t)} />
                    <span className="text-sm">{INVESTMENT_TYPE_LABELS[t]}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="budget_min">Orçamento mínimo (€)</Label>
                <Input id="budget_min" type="number" placeholder="150000" value={form.budget_min}
                  onChange={(e) => setForm((p) => ({ ...p, budget_min: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="budget_max">Orçamento máximo (€)</Label>
                <Input id="budget_max" type="number" placeholder="400000" value={form.budget_max}
                  onChange={(e) => setForm((p) => ({ ...p, budget_max: e.target.value }))} />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="min_yield">Yield bruto mínimo (%)</Label>
              <Input id="min_yield" type="number" step="0.1" placeholder="5.0" value={form.min_yield}
                onChange={(e) => setForm((p) => ({ ...p, min_yield: e.target.value }))} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Perfil de risco</Label>
                <Select value={form.risk_level} onValueChange={(v) => setForm((p) => ({ ...p, risk_level: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(RISK_LEVEL_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Horizonte temporal</Label>
                <Select value={form.investment_horizon} onValueChange={(v) => setForm((p) => ({ ...p, investment_horizon: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(INVESTMENT_HORIZON_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Obras máximas aceites</Label>
              <Select value={form.max_renovation} onValueChange={(v) => setForm((p) => ({ ...p, max_renovation: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(MAX_RENOVATION_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox checked={form.needs_financing}
                onCheckedChange={(checked) => setForm((p) => ({ ...p, needs_financing: !!checked }))} />
              <span className="text-sm">Necessita de financiamento bancário</span>
            </label>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Localização Preferida</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              {PORTUGUESE_ZONES.map((z) => (
                <label key={z} className="flex items-center gap-2 cursor-pointer">
                  <Checkbox checked={selectedZones.includes(z)} onCheckedChange={() => toggleZone(z)} />
                  <span className="text-sm">{z}</span>
                </label>
              ))}
            </div>
            <div className="flex gap-2">
              <Input placeholder="Outra zona..." value={customZone}
                onChange={(e) => setCustomZone(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addCustomZone())} />
              <Button type="button" variant="outline" onClick={addCustomZone}>Adicionar</Button>
            </div>
            {selectedZones.length > 0 && (
              <p className="text-sm text-gray-600">Selecionadas: {selectedZones.join(', ')}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Tipologias Preferidas</CardTitle></CardHeader>
          <CardContent>
            <div className="flex gap-2 flex-wrap">
              {['T0', 'T1', 'T2', 'T3', 'T4+'].map((t) => (
                <label key={t} className="flex items-center gap-2 cursor-pointer">
                  <Checkbox checked={selectedTypologies.includes(t)} onCheckedChange={() => toggleTypology(t)} />
                  <span className="text-sm">{t}</span>
                </label>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Notas</CardTitle></CardHeader>
          <CardContent>
            <Textarea placeholder="Informação adicional..." value={form.notes}
              onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} rows={3} />
          </CardContent>
        </Card>

        <div className="flex gap-3">
          <Button type="submit" className="flex-1" disabled={loading}>
            {loading ? 'A guardar...' : 'Guardar Alterações'}
          </Button>
          <Link href={`/dashboard/investors/${id}`}>
            <Button type="button" variant="outline">Cancelar</Button>
          </Link>
        </div>
      </form>
    </div>
  )
}
