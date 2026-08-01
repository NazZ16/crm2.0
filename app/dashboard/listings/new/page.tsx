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
import { ArrowLeft, Sparkles, Loader2 } from 'lucide-react'
import Link from 'next/link'
import {
  LISTING_BUSINESS_TYPE_LABELS, LISTING_PROPERTY_TYPE_LABELS,
  type ListingExtractionResult,
} from '@/lib/types'

const emptyForm = {
  reference: '', title: '', business_type: 'venda', property_type: 'apartamento',
  typology: '', price: '', condo_fee: '', imi_annual: '',
  district: '', municipality: '', parish: '', zone: '', address: '', zip_code: '',
  area_useful_m2: '', area_gross_m2: '', area_plot_m2: '',
  bedrooms: '', bathrooms: '', total_rooms: '', parking_spaces: '',
  has_elevator: '', construction_year: '', energy_rating: '',
  features: '', description: '', cover_image_url: '', source_url: '',
  notes: '',
  agent_name: '', agent_phone: '', agent_email: '',
}

type FormState = typeof emptyForm

function Field({ id, label, value, onChange, placeholder, type = 'text' }: {
  id: string; label: string; value: string; onChange: (v: string) => void
  placeholder?: string; type?: string
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs text-gray-600">{label}</Label>
      <Input id={id} type={type} placeholder={placeholder} value={value}
        onChange={(e) => onChange(e.target.value)} className="h-8 text-sm" />
    </div>
  )
}

export default function NewListingPage() {
  const router = useRouter()
  const [rawHtml, setRawHtml] = useState('')
  const [extracting, setExtracting] = useState(false)
  const [extracted, setExtracted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<FormState>(emptyForm)

  const set = (k: keyof FormState, v: string) => setForm((p) => ({ ...p, [k]: v }))

  async function handleExtract() {
    if (!rawHtml.trim()) {
      toast.error('Cola primeiro o HTML/texto da página do imóvel')
      return
    }
    setExtracting(true)
    try {
      const res = await fetch('/api/listings/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw_html: rawHtml }),
      })
      const data: ListingExtractionResult = await res.json()
      if (!res.ok) { toast.error('Erro ao extrair dados'); return }

      setForm((p) => ({
        ...p,
        reference: data.reference ?? p.reference,
        title: data.title ?? p.title,
        business_type: data.business_type ?? p.business_type,
        property_type: data.property_type ?? p.property_type,
        typology: data.typology ?? p.typology,
        price: data.price != null ? String(data.price) : p.price,
        condo_fee: data.condo_fee != null ? String(data.condo_fee) : p.condo_fee,
        imi_annual: data.imi_annual != null ? String(data.imi_annual) : p.imi_annual,
        district: data.district ?? p.district,
        municipality: data.municipality ?? p.municipality,
        parish: data.parish ?? p.parish,
        address: data.address ?? p.address,
        zip_code: data.zip_code ?? p.zip_code,
        area_useful_m2: data.area_useful_m2 != null ? String(data.area_useful_m2) : p.area_useful_m2,
        area_gross_m2: data.area_gross_m2 != null ? String(data.area_gross_m2) : p.area_gross_m2,
        area_plot_m2: data.area_plot_m2 != null ? String(data.area_plot_m2) : p.area_plot_m2,
        bedrooms: data.bedrooms != null ? String(data.bedrooms) : p.bedrooms,
        bathrooms: data.bathrooms != null ? String(data.bathrooms) : p.bathrooms,
        total_rooms: data.total_rooms != null ? String(data.total_rooms) : p.total_rooms,
        parking_spaces: data.parking_spaces != null ? String(data.parking_spaces) : p.parking_spaces,
        has_elevator: data.has_elevator != null ? String(data.has_elevator) : p.has_elevator,
        construction_year: data.construction_year != null ? String(data.construction_year) : p.construction_year,
        energy_rating: data.energy_rating ?? p.energy_rating,
        features: data.features.length > 0 ? data.features.join(', ') : p.features,
        description: data.description ?? p.description,
        cover_image_url: data.cover_image_url ?? p.cover_image_url,
        source_url: data.source_url ?? p.source_url,
      }))
      setExtracted(true)
      toast.success('Dados extraídos — revê e corrige antes de guardar')
    } finally {
      setExtracting(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.title.trim()) {
      toast.error('Indica um título para o imóvel')
      return
    }
    setSaving(true)

    const num = (v: string) => (v.trim() ? Number(v) : undefined)
    const int = (v: string) => (v.trim() ? parseInt(v, 10) : undefined)

    const body: Record<string, unknown> = {
      reference: form.reference.trim() || undefined,
      title: form.title.trim(),
      business_type: form.business_type,
      property_type: form.property_type,
      typology: form.typology.trim() || undefined,
      price: num(form.price),
      condo_fee: num(form.condo_fee),
      imi_annual: num(form.imi_annual),
      district: form.district.trim() || undefined,
      municipality: form.municipality.trim() || undefined,
      parish: form.parish.trim() || undefined,
      zone: form.zone.trim() || undefined,
      address: form.address.trim() || undefined,
      zip_code: form.zip_code.trim() || undefined,
      area_useful_m2: num(form.area_useful_m2),
      area_gross_m2: num(form.area_gross_m2),
      area_plot_m2: num(form.area_plot_m2),
      bedrooms: int(form.bedrooms),
      bathrooms: int(form.bathrooms),
      total_rooms: int(form.total_rooms),
      parking_spaces: int(form.parking_spaces),
      has_elevator: form.has_elevator ? form.has_elevator === 'true' : undefined,
      construction_year: int(form.construction_year),
      energy_rating: form.energy_rating.trim() || undefined,
      features: form.features.split(',').map((f) => f.trim()).filter(Boolean),
      description: form.description.trim() || undefined,
      cover_image_url: form.cover_image_url.trim() || undefined,
      source: extracted ? 'import' : 'manual',
      source_url: form.source_url.trim() || undefined,
      notes: form.notes.trim() || undefined,
      agent_name: form.agent_name.trim() || undefined,
      agent_phone: form.agent_phone.trim() || undefined,
      agent_email: form.agent_email.trim() || undefined,
    }

    const res = await fetch('/api/listings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    if (!res.ok) { toast.error(data.error?.message ?? data.error ?? 'Erro ao guardar'); setSaving(false); return }
    toast.success('Imóvel guardado!')
    router.push(`/dashboard/listings/${data.id}`)
  }

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-4">
      <Link href="/dashboard/listings" className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1">
        <ArrowLeft size={14} /> Voltar
      </Link>
      <h1 className="text-xl md:text-2xl font-bold text-gray-900">Importar Imóvel</h1>
      <p className="text-sm text-gray-500 -mt-2">
        Cola o HTML da página do imóvel (ex.: Maxwork/RE-MAX) para preencher os campos automaticamente, ou preenche à mão.
        {' '}Também podes usar o{' '}
        <Link href="/dashboard/listings/import-tool" className="text-blue-600 underline">bookmarklet de importação directa</Link>.
      </p>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Importar de HTML/texto</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <Textarea
            placeholder="Cola aqui o HTML da página do imóvel..."
            value={rawHtml}
            onChange={(e) => setRawHtml(e.target.value)}
            rows={6}
            className="text-xs font-mono"
          />
          <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={handleExtract} disabled={extracting}>
            {extracting ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {extracting ? 'A extrair...' : 'Extrair dados'}
          </Button>
        </CardContent>
      </Card>

      <form onSubmit={handleSubmit} className="space-y-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Identificação</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Field id="title" label="Título *" value={form.title} onChange={(v) => set('title', v)} placeholder="Moradia T3 em Maceda" />
            <div className="grid grid-cols-2 gap-2">
              <Field id="reference" label="Referência" value={form.reference} onChange={(v) => set('reference', v)} placeholder="124601389-20" />
              <div className="space-y-1">
                <Label className="text-xs text-gray-600">Tipo de negócio</Label>
                <Select value={form.business_type} onValueChange={(v) => set('business_type', v)}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(LISTING_BUSINESS_TYPE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs text-gray-600">Tipo de imóvel</Label>
                <Select value={form.property_type} onValueChange={(v) => set('property_type', v)}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(LISTING_PROPERTY_TYPE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <Field id="typology" label="Tipologia" value={form.typology} onChange={(v) => set('typology', v)} placeholder="T3" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Preço</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-3 gap-2">
            <Field id="price" label="Preço (€)" type="number" value={form.price} onChange={(v) => set('price', v)} placeholder="345000" />
            <Field id="condo_fee" label="Condomínio (€/mês)" type="number" value={form.condo_fee} onChange={(v) => set('condo_fee', v)} />
            <Field id="imi_annual" label="IMI anual (€)" type="number" value={form.imi_annual} onChange={(v) => set('imi_annual', v)} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Localização</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <Field id="address" label="Morada" value={form.address} onChange={(v) => set('address', v)} />
              <Field id="zip_code" label="Código Postal" value={form.zip_code} onChange={(v) => set('zip_code', v)} placeholder="4880-250" />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Field id="district" label="Distrito" value={form.district} onChange={(v) => set('district', v)} />
              <Field id="municipality" label="Concelho" value={form.municipality} onChange={(v) => set('municipality', v)} />
              <Field id="parish" label="Freguesia" value={form.parish} onChange={(v) => set('parish', v)} />
            </div>
            <Field id="zone" label="Zona (usada no matching com leads)" value={form.zone} onChange={(v) => set('zone', v)} placeholder="ex.: Aveiro, Maceda..." />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Áreas e Divisões</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <div className="grid grid-cols-3 gap-2">
              <Field id="area_useful_m2" label="Área útil (m²)" type="number" value={form.area_useful_m2} onChange={(v) => set('area_useful_m2', v)} />
              <Field id="area_gross_m2" label="Área bruta (m²)" type="number" value={form.area_gross_m2} onChange={(v) => set('area_gross_m2', v)} />
              <Field id="area_plot_m2" label="Área do lote (m²)" type="number" value={form.area_plot_m2} onChange={(v) => set('area_plot_m2', v)} />
            </div>
            <div className="grid grid-cols-4 gap-2">
              <Field id="bedrooms" label="Quartos" type="number" value={form.bedrooms} onChange={(v) => set('bedrooms', v)} />
              <Field id="bathrooms" label="Casas de banho" type="number" value={form.bathrooms} onChange={(v) => set('bathrooms', v)} />
              <Field id="total_rooms" label="Total divisões" type="number" value={form.total_rooms} onChange={(v) => set('total_rooms', v)} />
              <Field id="parking_spaces" label="Lugares garagem" type="number" value={form.parking_spaces} onChange={(v) => set('parking_spaces', v)} />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label className="text-xs text-gray-600">Elevador</Label>
                <Select value={form.has_elevator} onValueChange={(v) => set('has_elevator', v)}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true">Sim</SelectItem>
                    <SelectItem value="false">Não</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Field id="construction_year" label="Ano construção" type="number" value={form.construction_year} onChange={(v) => set('construction_year', v)} />
              <Field id="energy_rating" label="Classe energética" value={form.energy_rating} onChange={(v) => set('energy_rating', v)} placeholder="A+" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Descrição e Media</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <div className="space-y-1">
              <Label htmlFor="features" className="text-xs text-gray-600">Características (separadas por vírgula)</Label>
              <Input id="features" value={form.features} onChange={(e) => set('features', e.target.value)}
                placeholder="Varanda, Garagem, Jardim..." className="h-8 text-sm" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="description" className="text-xs text-gray-600">Descrição</Label>
              <Textarea id="description" value={form.description} onChange={(e) => set('description', e.target.value)} rows={4} className="text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field id="cover_image_url" label="URL da foto de capa" value={form.cover_image_url} onChange={(v) => set('cover_image_url', v)} />
              <Field id="source_url" label="Link do anúncio" value={form.source_url} onChange={(v) => set('source_url', v)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="notes" className="text-xs text-gray-600">Notas privadas</Label>
              <Textarea id="notes" value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={2} className="text-sm" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Agente</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-3 gap-2">
            <Field id="agent_name" label="Nome" value={form.agent_name} onChange={(v) => set('agent_name', v)} />
            <Field id="agent_phone" label="Telefone" value={form.agent_phone} onChange={(v) => set('agent_phone', v)} />
            <Field id="agent_email" label="Email" type="email" value={form.agent_email} onChange={(v) => set('agent_email', v)} />
          </CardContent>
        </Card>

        <div className="flex gap-3">
          <Button type="submit" className="flex-1" disabled={saving}>
            {saving ? 'A guardar...' : 'Guardar Imóvel'}
          </Button>
          <Link href="/dashboard/listings">
            <Button type="button" variant="outline">Cancelar</Button>
          </Link>
        </div>
      </form>
    </div>
  )
}
