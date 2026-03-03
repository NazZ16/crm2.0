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
import { ArrowLeft, TrendingUp, Home, Wrench } from 'lucide-react'
import Link from 'next/link'
import { PROPERTY_TYPE_LABELS } from '@/lib/types'
import { formatEur, formatPct } from '@/lib/roi-calculator'

type DealMode = 'buy_to_let' | 'fix_and_flip' | null

// ─── Preview de ROI para buy-to-let ──────────────────────────
function previewBtl(form: Record<string, string>) {
  const preco = parseInt(form.negotiated_price || form.asking_price || '0')
  const renda = parseInt(form.estimated_monthly_rent || '0')
  if (!preco || !renda) return null
  const rendaAnual = renda * 12
  const encargos = (parseInt(form.condo_fee || '0') * 12) + parseInt(form.annual_imi || '0') + rendaAnual * 0.1
  const yieldBruto = (rendaAnual / preco) * 100
  const yieldLiquido = ((rendaAnual - encargos) / preco) * 100
  const payback = (rendaAnual - encargos) > 0 ? preco / (rendaAnual - encargos) : null
  return { yieldBruto, yieldLiquido, payback }
}

// ─── Preview de ROI para fix & flip ──────────────────────────
function previewFf(form: Record<string, string>) {
  const preco = parseInt(form.negotiated_price || form.asking_price || '0')
  const sellPrice = parseInt(form.estimated_sell_price || '0')
  if (!preco || !sellPrice) return null

  const entryPct = parseFloat(form.financing_entry_pct || '100')
  const financingAmt = preco * (1 - entryPct / 100)

  // Aquisição
  const imt = calcImtSimple(preco)
  const is = preco * parseFloat(form.imposto_selo_pct || '0.008')
  const escritura = parseInt(form.escritura_cost || '1000')
  const totalAquisicao = imt + is + escritura

  // Financiamento
  let totalJuros = 0
  if (financingAmt > 0 && form.financing_interest_pct && form.financing_years) {
    const r = parseFloat(form.financing_interest_pct) / 100 / 12
    const n = parseInt(form.financing_years) * 12
    const pmt = (financingAmt * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1)
    totalJuros = pmt * n - financingAmt
  }

  // Obras
  const totalObras = ['construction_cost', 'operational_expenses', 'renovation_item3', 'renovation_item4', 'renovation_item5']
    .reduce((s, k) => s + parseInt(form[k] || '0'), 0)

  // Transitórios
  const months = parseInt(form.holding_months || '12')
  const mensais = ['insurance_monthly', 'condo_fee', 'electricity_monthly', 'water_monthly']
    .reduce((s, k) => s + parseInt(form[k] || '0'), 0)
  const totalTransit = mensais * months + totalJuros

  // Venda
  const comissao = sellPrice * parseFloat(form.sale_commission_pct || '4') / 100 * 1.23
  const totalVenda = comissao + (financingAmt * parseFloat(form.early_repayment_penalty_pct || '0') / 100)

  const totalFinanciamento = totalJuros + (financingAmt * parseFloat(form.financing_stamp_duty_pct || '0.6') / 100)
  const custoTotal = preco + totalAquisicao + totalJuros + totalObras + totalTransit + totalVenda
  const lucroBruto = sellPrice - custoTotal
  // Capital investido = preço + custos aquisição + custos financiamento + obras + transitórios
  const capitalProprio = preco + totalAquisicao + totalFinanciamento + totalObras + totalTransit
  const ircValor = lucroBruto > 0 ? lucroBruto * parseFloat(form.irc_rate || '19') / 100 : 0
  const lucroLiquidoIrc = lucroBruto - ircValor
  const operadorPct = parseFloat(form.operator_profit_pct || '25') / 100
  const investidoresLucro = lucroLiquidoIrc * (1 - operadorPct)
  const roiTotal = custoTotal > 0 ? (lucroBruto / custoTotal) * 100 : 0
  const contractMonths = parseInt(form.reform_months || form.holding_months || '12')
  const roiAnualizado = contractMonths > 0 ? roiTotal / (contractMonths / 12) : roiTotal
  const cashOnCash = capitalProprio > 0 ? (lucroBruto / capitalProprio) * 100 : 0

  return { custoTotal, lucroBruto, roiTotal, roiAnualizado, cashOnCash, capitalProprio, imt, escritura: Math.round(escritura), totalObras, lucroLiquidoIrc, investidoresLucro }
}

function calcImtSimple(preco: number) {
  if (preco <= 106346) return Math.round(preco * 0.01)
  if (preco <= 145470) return Math.max(0, Math.round(preco * 0.02 - 1063.46))
  if (preco <= 198347) return Math.max(0, Math.round(preco * 0.05 - 5427.56))
  if (preco <= 330539) return Math.max(0, Math.round(preco * 0.07 - 9394.50))
  if (preco <= 633931) return Math.max(0, Math.round(preco * 0.08 - 12699.89))
  if (preco <= 1150853) return Math.round(preco * 0.06)
  return Math.round(preco * 0.075)
}

function NumInput({ id, label, value, onChange, placeholder = '0', step, hint }: {
  id: string; label: string; value: string; onChange: (v: string) => void
  placeholder?: string; step?: string; hint?: string
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs text-gray-600">{label}</Label>
      <Input id={id} type="number" step={step} placeholder={placeholder} value={value}
        onChange={(e) => onChange(e.target.value)} className="h-8 text-sm" />
      {hint && <p className="text-xs text-gray-400">{hint}</p>}
    </div>
  )
}

export default function NewOpportunityPage() {
  const router = useRouter()
  const [mode, setMode] = useState<DealMode>(null)
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState<Record<string, string>>({
    title: '', address: '', zone: '', typology: '', property_type: 'apartment',
    asking_price: '', negotiated_price: '', area_m2: '', vpt: '',
    source: '', description: '',
    // Buy-to-let
    estimated_monthly_rent: '', condo_fee: '', annual_imi: '', renovation_cost: '',
    // Fix & flip
    imposto_selo_pct: '0.008', escritura_cost: '1000',
    financing_entry_pct: '100', financing_interest_pct: '5', financing_years: '12',
    financing_stamp_duty_pct: '0.006', financing_dossier: '0', financing_evaluation: '0',
    financing_formalization: '0', financing_mortgage_registry: '0',
    holding_months: '12', insurance_monthly: '0', electricity_monthly: '0', water_monthly: '0',
    construction_cost: '', operational_expenses: '', renovation_item3: '0',
    renovation_item4: '0', renovation_item5: '0',
    estimated_sell_price: '',
    sale_commission_pct: '4', sale_commission2_pct: '0', sale_commission3_pct: '0',
    early_repayment_penalty_pct: '0',
    operator_profit_pct: '25', irc_rate: '19', reform_months: '10',
    contract_type: 'empreiteiro',
  })

  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }))

  const btlPreview = useMemo(() => mode === 'buy_to_let' ? previewBtl(form) : null, [form, mode])
  const ffPreview = useMemo(() => mode === 'fix_and_flip' ? previewFf(form) : null, [form, mode])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.title.trim() || !form.zone.trim() || !form.asking_price || !mode) {
      toast.error('Preenche título, zona e preço')
      return
    }
    setLoading(true)

    const num = (k: string) => form[k] ? parseInt(form[k]) : undefined
    const flt = (k: string) => form[k] ? parseFloat(form[k]) : undefined

    const body: Record<string, unknown> = {
      title: form.title.trim(),
      address: form.address.trim() || undefined,
      zone: form.zone.trim(),
      typology: form.typology || undefined,
      property_type: form.property_type,
      deal_type: mode,
      asking_price: parseInt(form.asking_price),
      negotiated_price: num('negotiated_price'),
      area_m2: num('area_m2'),
      vpt: num('vpt'),
      source: form.source.trim() || undefined,
      description: form.description.trim() || undefined,
    }

    if (mode === 'buy_to_let') {
      body.estimated_monthly_rent = num('estimated_monthly_rent')
      body.condo_fee = num('condo_fee') ?? 0
      body.annual_imi = num('annual_imi') ?? 0
      body.renovation_cost = num('renovation_cost') ?? 0
    } else {
      // Fix & flip — todos os campos
      body.imposto_selo_pct = flt('imposto_selo_pct') ?? 0.008
      body.escritura_cost = num('escritura_cost') ?? 1000
      body.financing_entry_pct = flt('financing_entry_pct') ?? 100
      body.financing_interest_pct = flt('financing_interest_pct')
      body.financing_years = num('financing_years')
      body.financing_stamp_duty_pct = flt('financing_stamp_duty_pct') ?? 0.006
      body.financing_dossier = num('financing_dossier') ?? 0
      body.financing_evaluation = num('financing_evaluation') ?? 0
      body.financing_formalization = num('financing_formalization') ?? 0
      body.financing_mortgage_registry = num('financing_mortgage_registry') ?? 0
      body.holding_months = num('holding_months') ?? 12
      body.insurance_monthly = num('insurance_monthly') ?? 0
      body.condo_fee = num('condo_fee') ?? 0
      body.electricity_monthly = num('electricity_monthly') ?? 0
      body.water_monthly = num('water_monthly') ?? 0
      body.construction_cost = num('construction_cost') ?? 0
      body.operational_expenses = num('operational_expenses') ?? 0
      body.renovation_item3 = num('renovation_item3') ?? 0
      body.renovation_item4 = num('renovation_item4') ?? 0
      body.renovation_item5 = num('renovation_item5') ?? 0
      body.estimated_sell_price = num('estimated_sell_price')
      body.sale_commission_pct = flt('sale_commission_pct') ?? 4
      body.sale_commission2_pct = flt('sale_commission2_pct') ?? 0
      body.sale_commission3_pct = flt('sale_commission3_pct') ?? 0
      body.early_repayment_penalty_pct = flt('early_repayment_penalty_pct') ?? 0
      body.operator_profit_pct = flt('operator_profit_pct') ?? 25
      body.irc_rate = flt('irc_rate') ?? 19
      body.reform_months = num('reform_months')
      body.contract_type = form.contract_type || undefined
    }

    const res = await fetch('/api/opportunities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    if (!res.ok) { toast.error(data.error || 'Erro'); setLoading(false); return }
    toast.success('Oportunidade criada!')
    router.push(`/dashboard/opportunities/${data.id}`)
  }

  // ─── Escolha de modo ─────────────────────────────────────────
  if (!mode) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <Link href="/dashboard/opportunities" className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1 mb-6">
          <ArrowLeft size={14} /> Voltar
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Nova Oportunidade</h1>
        <p className="text-sm text-gray-500 mb-8">Escolhe o tipo de negócio</p>
        <div className="grid grid-cols-2 gap-4">
          <button
            onClick={() => setMode('buy_to_let')}
            className="text-left p-6 rounded-xl border-2 border-gray-200 hover:border-blue-500 hover:bg-blue-50 transition-all group"
          >
            <Home size={32} className="text-blue-500 mb-3" />
            <h2 className="text-lg font-bold text-gray-900 group-hover:text-blue-700">Buy-to-Let</h2>
            <p className="text-sm text-gray-500 mt-1">Compra para arrendamento — análise de yield e cash flow mensal</p>
          </button>
          <button
            onClick={() => setMode('fix_and_flip')}
            className="text-left p-6 rounded-xl border-2 border-gray-200 hover:border-orange-500 hover:bg-orange-50 transition-all group"
          >
            <Wrench size={32} className="text-orange-500 mb-3" />
            <h2 className="text-lg font-bold text-gray-900 group-hover:text-orange-700">Fix & Flip</h2>
            <p className="text-sm text-gray-500 mt-1">Compra, obras e venda — análise completa de ROI, IRC e split de lucro</p>
          </button>
        </div>
      </div>
    )
  }

  const isFf = mode === 'fix_and_flip'

  return (
    <div className={`p-6 max-w-${isFf ? '4xl' : '2xl'} mx-auto`}>
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => setMode(null)} className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1">
          <ArrowLeft size={14} /> Voltar
        </button>
        <span className="text-gray-300">|</span>
        <h1 className="text-xl font-bold text-gray-900">
          {isFf ? 'Fix & Flip' : 'Buy-to-Let'} — Nova Oportunidade
        </h1>
      </div>

      <form onSubmit={handleSubmit}>
        <div className={isFf ? 'grid grid-cols-1 lg:grid-cols-3 gap-4' : 'space-y-4'}>

          {/* ── COLUNA ESQUERDA (inputs) ── */}
          <div className={`space-y-4 ${isFf ? '' : ''}`}>

            {/* Identificação */}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Identificação</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="title" className="text-xs text-gray-600">Título *</Label>
                  <Input id="title" placeholder="Moradia 473 || Maceda" value={form.title}
                    onChange={(e) => set('title', e.target.value)} required className="h-8 text-sm" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <NumInput id="area_m2" label="Área (m²)" value={form.area_m2} onChange={(v) => set('area_m2', v)} placeholder="360" />
                  <div className="space-y-1">
                    <Label className="text-xs text-gray-600">Tipologia</Label>
                    <Select value={form.typology} onValueChange={(v) => set('typology', v)}>
                      <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="T?" /></SelectTrigger>
                      <SelectContent>
                        {['T0','T1','T2','T3','T4+'].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label htmlFor="zone" className="text-xs text-gray-600">Zona *</Label>
                    <Input id="zone" placeholder="Maceda, Aveiro" value={form.zone}
                      onChange={(e) => set('zone', e.target.value)} required className="h-8 text-sm" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-gray-600">Tipo de imóvel</Label>
                    <Select value={form.property_type} onValueChange={(v) => set('property_type', v)}>
                      <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(PROPERTY_TYPE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="address" className="text-xs text-gray-600">Morada</Label>
                  <Input id="address" placeholder="Rua..." value={form.address}
                    onChange={(e) => set('address', e.target.value)} className="h-8 text-sm" />
                </div>
              </CardContent>
            </Card>

            {/* Preços */}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Preços</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                <NumInput id="asking_price" label="Preço de Aquisição (€) *" value={form.asking_price} onChange={(v) => set('asking_price', v)} placeholder="140000" />
                {isFf && <NumInput id="vpt" label="VPT (€)" value={form.vpt} onChange={(v) => set('vpt', v)} placeholder="15022" hint="Usado no cálculo IMT" />}
                <NumInput id="negotiated_price" label="Preço negociado (€)" value={form.negotiated_price} onChange={(v) => set('negotiated_price', v)} />
                {isFf && (
                  <>
                    <NumInput id="estimated_sell_price" label="Preço estimado de Venda (€)" value={form.estimated_sell_price} onChange={(v) => set('estimated_sell_price', v)} placeholder="800000" />
                    <div className="grid grid-cols-2 gap-2">
                      <NumInput id="imposto_selo_pct" label="IS escritura (%)" value={String(parseFloat(form.imposto_selo_pct || '0.008') * 100)} onChange={(v) => set('imposto_selo_pct', String(parseFloat(v) / 100))} placeholder="0.8" step="0.1" />
                      <NumInput id="escritura_cost" label="Escritura/DPA (€)" value={form.escritura_cost} onChange={(v) => set('escritura_cost', v)} placeholder="1000" />
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Buy-to-Let específico */}
            {!isFf && (
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Rendimento de Arrendamento</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  <NumInput id="estimated_monthly_rent" label="Renda estimada (€/mês)" value={form.estimated_monthly_rent} onChange={(v) => set('estimated_monthly_rent', v)} placeholder="1100" />
                  <div className="grid grid-cols-2 gap-2">
                    <NumInput id="condo_fee" label="Condomínio (€/mês)" value={form.condo_fee} onChange={(v) => set('condo_fee', v)} />
                    <NumInput id="annual_imi" label="IMI anual (€)" value={form.annual_imi} onChange={(v) => set('annual_imi', v)} />
                  </div>
                  <NumInput id="renovation_cost" label="Obras (€)" value={form.renovation_cost} onChange={(v) => set('renovation_cost', v)} />
                </CardContent>
              </Card>
            )}

            {/* Fix & Flip — Financiamento */}
            {isFf && (
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Financiamento</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  <div className="grid grid-cols-3 gap-2">
                    <NumInput id="financing_entry_pct" label="Entrada (%)" value={form.financing_entry_pct} onChange={(v) => set('financing_entry_pct', v)} placeholder="100" step="1" />
                    <NumInput id="financing_interest_pct" label="Taxa juro (%)" value={form.financing_interest_pct} onChange={(v) => set('financing_interest_pct', v)} placeholder="5" step="0.1" />
                    <NumInput id="financing_years" label="Prazo (anos)" value={form.financing_years} onChange={(v) => set('financing_years', v)} placeholder="12" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <NumInput id="financing_stamp_duty_pct" label="IS verba financiada (%)" value={String(parseFloat(form.financing_stamp_duty_pct || '0.006') * 100)} onChange={(v) => set('financing_stamp_duty_pct', String(parseFloat(v) / 100))} placeholder="0.6" step="0.1" />
                    <NumInput id="financing_dossier" label="Comissão Dossier (€)" value={form.financing_dossier} onChange={(v) => set('financing_dossier', v)} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <NumInput id="financing_evaluation" label="Comissão Avaliação (€)" value={form.financing_evaluation} onChange={(v) => set('financing_evaluation', v)} />
                    <NumInput id="financing_formalization" label="Comissão Formalização (€)" value={form.financing_formalization} onChange={(v) => set('financing_formalization', v)} />
                  </div>
                  <NumInput id="financing_mortgage_registry" label="Registo Hipoteca (€)" value={form.financing_mortgage_registry} onChange={(v) => set('financing_mortgage_registry', v)} />
                </CardContent>
              </Card>
            )}
          </div>

          {/* ── COLUNA CENTRAL (fix & flip campos restantes) ── */}
          {isFf && (
            <div className="space-y-4">
              {/* Custos Transitórios */}
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Custos Transitórios</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <NumInput id="holding_months" label="Nº meses em posse" value={form.holding_months} onChange={(v) => set('holding_months', v)} />
                    <NumInput id="reform_months" label="Período obra (meses)" value={form.reform_months} onChange={(v) => set('reform_months', v)} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <NumInput id="insurance_monthly" label="Seguros/mês (€)" value={form.insurance_monthly} onChange={(v) => set('insurance_monthly', v)} />
                    <NumInput id="condo_fee" label="Condomínio/mês (€)" value={form.condo_fee} onChange={(v) => set('condo_fee', v)} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <NumInput id="electricity_monthly" label="Eletricidade/mês (€)" value={form.electricity_monthly} onChange={(v) => set('electricity_monthly', v)} placeholder="150" />
                    <NumInput id="water_monthly" label="Água/mês (€)" value={form.water_monthly} onChange={(v) => set('water_monthly', v)} placeholder="150" />
                  </div>
                </CardContent>
              </Card>

              {/* Obras */}
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Obras</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  <NumInput id="construction_cost" label="Empreitada (€)" value={form.construction_cost} onChange={(v) => set('construction_cost', v)} placeholder="323181" />
                  <NumInput id="operational_expenses" label="Despesas Operacionais (€)" value={form.operational_expenses} onChange={(v) => set('operational_expenses', v)} placeholder="12600" />
                  <NumInput id="renovation_item3" label="Rúbrica 3 (€)" value={form.renovation_item3} onChange={(v) => set('renovation_item3', v)} />
                  <NumInput id="renovation_item4" label="Rúbrica 4 (€)" value={form.renovation_item4} onChange={(v) => set('renovation_item4', v)} />
                  <NumInput id="renovation_item5" label="Rúbrica 5 (€)" value={form.renovation_item5} onChange={(v) => set('renovation_item5', v)} />
                </CardContent>
              </Card>

              {/* Custos de Venda */}
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Custos com Venda do Imóvel</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  <NumInput id="sale_commission_pct" label="% Comissão imobiliária" value={form.sale_commission_pct} onChange={(v) => set('sale_commission_pct', v)} placeholder="4" step="0.1" />
                  <NumInput id="sale_commission2_pct" label="% Comissão 2" value={form.sale_commission2_pct} onChange={(v) => set('sale_commission2_pct', v)} step="0.1" />
                  <NumInput id="sale_commission3_pct" label="% Comissão 3" value={form.sale_commission3_pct} onChange={(v) => set('sale_commission3_pct', v)} step="0.1" />
                  <NumInput id="early_repayment_penalty_pct" label="% Penalização amortização antecipada" value={form.early_repayment_penalty_pct} onChange={(v) => set('early_repayment_penalty_pct', v)} step="0.1" />
                </CardContent>
              </Card>

              {/* Split */}
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Split do Negócio</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <NumInput id="operator_profit_pct" label="Operador (% lucro líquido)" value={form.operator_profit_pct} onChange={(v) => set('operator_profit_pct', v)} placeholder="25" step="1" />
                    <NumInput id="irc_rate" label="Taxa IRC (%)" value={form.irc_rate} onChange={(v) => set('irc_rate', v)} placeholder="19" step="1" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-gray-600">Tipo de Contrato</Label>
                    <Select value={form.contract_type} onValueChange={(v) => set('contract_type', v)}>
                      <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="empreiteiro">Empreiteiro</SelectItem>
                        <SelectItem value="administracao_direta">Administração Direta</SelectItem>
                        <SelectItem value="misto">Misto</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ── COLUNA DIREITA (preview ROI + notas + submit) ── */}
          <div className="space-y-4">
            {/* Preview ROI */}
            {btlPreview && (
              <Card className="border-green-200 bg-green-50">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2 text-green-800">
                    <TrendingUp size={14} /> Pré-visualização ROI
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-green-700">Yield Bruto</span>
                    <span className="font-bold text-green-900">{formatPct(btlPreview.yieldBruto)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-green-700">Yield Líquido</span>
                    <span className="font-bold text-green-900">{formatPct(btlPreview.yieldLiquido)}</span>
                  </div>
                  {btlPreview.payback && (
                    <div className="flex justify-between">
                      <span className="text-green-700">Payback</span>
                      <span className="font-bold text-green-900">{btlPreview.payback.toFixed(1)} anos</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {ffPreview && (
              <Card className="border-orange-200 bg-orange-50">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2 text-orange-800">
                    <TrendingUp size={14} /> Pré-visualização ROI
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-orange-700">Custo total negócio</span>
                    <span className="font-bold text-orange-900">{formatEur(ffPreview.custoTotal)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-orange-700">Lucro Bruto</span>
                    <span className={`font-bold ${ffPreview.lucroBruto >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                      {formatEur(ffPreview.lucroBruto)}
                    </span>
                  </div>
                  <div className="border-t border-orange-200 pt-1.5 mt-1.5">
                    <div className="flex justify-between">
                      <span className="text-orange-700">ROI Total</span>
                      <span className="font-bold text-orange-900">{formatPct(ffPreview.roiTotal)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-orange-700">ROI Anualizado</span>
                      <span className="font-bold text-orange-900">{formatPct(ffPreview.roiAnualizado)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-orange-700">Cash-on-Cash</span>
                      <span className="font-bold text-orange-900">{formatPct(ffPreview.cashOnCash)}</span>
                    </div>
                  </div>
                  <div className="border-t border-orange-200 pt-1.5 mt-1.5">
                    <div className="flex justify-between">
                      <span className="text-orange-700">Capital próprio</span>
                      <span className="font-medium">{formatEur(ffPreview.capitalProprio)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-orange-700">Lucro Líq. IRC</span>
                      <span className="font-medium">{formatEur(ffPreview.lucroLiquidoIrc)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-orange-700">Para Investidores</span>
                      <span className="font-bold text-green-700">{formatEur(ffPreview.investidoresLucro)}</span>
                    </div>
                  </div>
                  <div className="text-xs text-orange-600 pt-1 border-t border-orange-200">
                    IMT: {formatEur(ffPreview.imt)} · Escritura: {formatEur(ffPreview.escritura)} · Obras: {formatEur(ffPreview.totalObras)}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Fonte + descrição */}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Notas</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                <div className="space-y-1">
                  <Label htmlFor="source" className="text-xs text-gray-600">Fonte</Label>
                  <Input id="source" placeholder="Remax, Era, Imovirtual..." value={form.source}
                    onChange={(e) => set('source', e.target.value)} className="h-8 text-sm" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="description" className="text-xs text-gray-600">Descrição</Label>
                  <Textarea id="description" placeholder="Notas sobre o imóvel..." value={form.description}
                    onChange={(e) => set('description', e.target.value)} rows={3} className="text-sm" />
                </div>
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
          </div>
        </div>
      </form>
    </div>
  )
}
