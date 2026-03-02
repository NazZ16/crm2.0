'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from 'sonner'
import { ArrowLeft, TrendingUp } from 'lucide-react'
import Link from 'next/link'
import { PROPERTY_TYPE_LABELS } from '@/lib/types'
import { formatEur, formatPct } from '@/lib/roi-calculator'

function calcPreview(form: {
  asking_price: string; negotiated_price: string;
  estimated_monthly_rent: string; condo_fee: string;
  annual_imi: string; renovation_cost: string;
}) {
  const preco = parseInt(form.negotiated_price || form.asking_price || '0')
  const renda = parseInt(form.estimated_monthly_rent || '0')
  const condo = parseInt(form.condo_fee || '0')
  const imi = parseInt(form.annual_imi || '0')
  const renov = parseInt(form.renovation_cost || '0')

  if (!preco || !renda) return null

  const rendaAnual = renda * 12
  const gestao = rendaAnual * 0.1
  const encargos = condo * 12 + imi + gestao
  const yieldBruto = (rendaAnual / preco) * 100
  const yieldLiquido = ((rendaAnual - encargos) / preco) * 100

  // IMT simplificado
  let imt = 0
  if (preco > 97064) imt = Math.max(0, preco * 0.02 - 1941)
  if (preco > 132774) imt = Math.max(0, preco * 0.05 - 5924)
  if (preco > 181034) imt = Math.max(0, preco * 0.07 - 9545)
  if (preco > 301688) imt = Math.max(0, preco * 0.08 - 12562)
  imt = Math.round(imt)
  const escritura = Math.round(preco * 0.015)
  const capitalTotal = preco + imt + escritura + renov
  const cashFlow = rendaAnual - encargos
  const payback = cashFlow > 0 ? capitalTotal / cashFlow : null

  return { yieldBruto, yieldLiquido, imt, escritura, capitalTotal, cashFlow, payback }
}

export default function NewOpportunityPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    title: '',
    address: '',
    zone: '',
    typology: '',
    property_type: 'apartment',
    asking_price: '',
    negotiated_price: '',
    estimated_monthly_rent: '',
    condo_fee: '',
    annual_imi: '',
    renovation_cost: '',
    estimated_sell_price: '',
    source: '',
    description: '',
  })

  const preview = useMemo(() => calcPreview(form), [form])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.title.trim() || !form.zone.trim() || !form.asking_price) {
      toast.error('Título, zona e preço são obrigatórios')
      return
    }
    setLoading(true)

    const res = await fetch('/api/opportunities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: form.title.trim(),
        address: form.address.trim() || undefined,
        zone: form.zone.trim(),
        typology: form.typology || undefined,
        property_type: form.property_type,
        asking_price: parseInt(form.asking_price),
        negotiated_price: form.negotiated_price ? parseInt(form.negotiated_price) : undefined,
        estimated_monthly_rent: form.estimated_monthly_rent ? parseInt(form.estimated_monthly_rent) : undefined,
        condo_fee: form.condo_fee ? parseInt(form.condo_fee) : 0,
        annual_imi: form.annual_imi ? parseInt(form.annual_imi) : 0,
        renovation_cost: form.renovation_cost ? parseInt(form.renovation_cost) : 0,
        estimated_sell_price: form.estimated_sell_price ? parseInt(form.estimated_sell_price) : undefined,
        source: form.source.trim() || undefined,
        description: form.description.trim() || undefined,
      }),
    })

    const data = await res.json()
    if (!res.ok) {
      toast.error(data.error || 'Erro ao criar oportunidade')
      setLoading(false)
      return
    }

    toast.success('Oportunidade criada!')
    router.push(`/dashboard/opportunities/${data.id}`)
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-6">
        <Link href="/dashboard/opportunities" className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1 mb-4">
          <ArrowLeft size={14} />
          Voltar às oportunidades
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">Nova Oportunidade</h1>
        <p className="text-sm text-gray-500 mt-1">Regista um imóvel para análise de ROI e matching com investidores</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Identificação */}
        <Card>
          <CardHeader><CardTitle className="text-base">Identificação do Imóvel</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="title">Título *</Label>
              <Input id="title" placeholder="T2 Alvalade junto ao Metro" value={form.title}
                onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} required />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="zone">Zona *</Label>
                <Input id="zone" placeholder="Lisboa" value={form.zone}
                  onChange={(e) => setForm((p) => ({ ...p, zone: e.target.value }))} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="address">Morada</Label>
                <Input id="address" placeholder="Rua de Example, 123" value={form.address}
                  onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label>Tipo de imóvel</Label>
                <Select value={form.property_type} onValueChange={(v) => setForm((p) => ({ ...p, property_type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(PROPERTY_TYPE_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="typology">Tipologia</Label>
                <Select value={form.typology} onValueChange={(v) => setForm((p) => ({ ...p, typology: v }))}>
                  <SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger>
                  <SelectContent>
                    {['T0', 'T1', 'T2', 'T3', 'T4+'].map((t) => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="source">Fonte</Label>
                <Input id="source" placeholder="Remax, Imovirtual..." value={form.source}
                  onChange={(e) => setForm((p) => ({ ...p, source: e.target.value }))} />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Preços */}
        <Card>
          <CardHeader><CardTitle className="text-base">Preços</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="asking_price">Preço pedido (€) *</Label>
                <Input id="asking_price" type="number" placeholder="249000" value={form.asking_price}
                  onChange={(e) => setForm((p) => ({ ...p, asking_price: e.target.value }))} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="negotiated_price">Preço negociado (€)</Label>
                <Input id="negotiated_price" type="number" placeholder="235000" value={form.negotiated_price}
                  onChange={(e) => setForm((p) => ({ ...p, negotiated_price: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="renovation_cost">Custo obras (€)</Label>
                <Input id="renovation_cost" type="number" placeholder="0" value={form.renovation_cost}
                  onChange={(e) => setForm((p) => ({ ...p, renovation_cost: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="estimated_sell_price">Valor venda estimado (€)</Label>
                <Input id="estimated_sell_price" type="number" placeholder="Para buy-to-sell" value={form.estimated_sell_price}
                  onChange={(e) => setForm((p) => ({ ...p, estimated_sell_price: e.target.value }))} />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Rendimento */}
        <Card>
          <CardHeader><CardTitle className="text-base">Rendimento (Buy-to-Let)</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label htmlFor="estimated_monthly_rent">Renda estimada (€/mês)</Label>
                <Input id="estimated_monthly_rent" type="number" placeholder="1100" value={form.estimated_monthly_rent}
                  onChange={(e) => setForm((p) => ({ ...p, estimated_monthly_rent: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="condo_fee">Condomínio (€/mês)</Label>
                <Input id="condo_fee" type="number" placeholder="80" value={form.condo_fee}
                  onChange={(e) => setForm((p) => ({ ...p, condo_fee: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="annual_imi">IMI anual (€)</Label>
                <Input id="annual_imi" type="number" placeholder="500" value={form.annual_imi}
                  onChange={(e) => setForm((p) => ({ ...p, annual_imi: e.target.value }))} />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Preview ROI em tempo real */}
        {preview && (
          <Card className="border-green-200 bg-green-50">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2 text-green-800">
                <TrendingUp size={16} />
                Pré-visualização ROI
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="text-center">
                  <p className="text-xs text-green-700">Yield Bruto</p>
                  <p className="text-xl font-bold text-green-800">{formatPct(preview.yieldBruto)}</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-green-700">Yield Líquido</p>
                  <p className="text-xl font-bold text-green-800">{formatPct(preview.yieldLiquido)}</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-green-700">Capital Total</p>
                  <p className="text-sm font-bold text-green-800">{formatEur(preview.capitalTotal)}</p>
                  <p className="text-xs text-green-600">incl. IMT+escritura</p>
                </div>
                {preview.payback && (
                  <div className="text-center">
                    <p className="text-xs text-green-700">Payback</p>
                    <p className="text-xl font-bold text-green-800">{preview.payback.toFixed(1)} anos</p>
                  </div>
                )}
              </div>
              <div className="mt-2 pt-2 border-t border-green-200 grid grid-cols-2 gap-2 text-xs text-green-700">
                <span>IMT estimado: {formatEur(preview.imt)}</span>
                <span>Escritura: {formatEur(preview.escritura)}</span>
                <span>Cash Flow Anual: {formatEur(preview.cashFlow)}</span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Descrição */}
        <Card>
          <CardHeader><CardTitle className="text-base">Descrição</CardTitle></CardHeader>
          <CardContent>
            <Textarea
              placeholder="Notas sobre o imóvel, estado de conservação, pontos fortes..."
              value={form.description}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              rows={4}
            />
          </CardContent>
        </Card>

        <div className="flex gap-3">
          <Button type="submit" className="flex-1" disabled={loading}>
            {loading ? 'A guardar...' : 'Criar Oportunidade'}
          </Button>
          <Link href="/dashboard/opportunities">
            <Button type="button" variant="outline">Cancelar</Button>
          </Link>
        </div>
      </form>
    </div>
  )
}
