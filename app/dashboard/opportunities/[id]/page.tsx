'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  OPPORTUNITY_STATUS_LABELS, MATCH_STATUS_LABELS,
  type Opportunity, type InvestorMatch, type OpportunityInvestor,
} from '@/lib/types'
import { calcularRoi, calcularFixFlip, formatEur, formatPct } from '@/lib/roi-calculator'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { ArrowLeft, Bot, RefreshCw, CheckCircle2, AlertCircle, Phone, Mail, Trash2, Plus, TrendingUp } from 'lucide-react'

const STATUS_COLORS: Record<string, string> = {
  analyzing: 'bg-yellow-100 text-yellow-800',
  available: 'bg-green-100 text-green-800',
  under_offer: 'bg-blue-100 text-blue-800',
  closed: 'bg-gray-100 text-gray-700',
  passed: 'bg-red-100 text-red-700',
}

const MATCH_COLORS: Record<string, string> = {
  suggested: 'bg-gray-100 text-gray-700',
  presented: 'bg-blue-100 text-blue-800',
  interested: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-700',
  invested: 'bg-emerald-100 text-emerald-800',
}

interface FullOpportunity extends Opportunity {
  matches: (InvestorMatch & { investors: { id: string; name: string; phone: string | null; email: string | null } | null })[]
  deal_investors: (OpportunityInvestor & { investors: { id: string; name: string; phone: string | null; email: string | null } | null })[]
}

// ─── Linha de tabela formatada ────────────────────────────────
function Row({ label, value, bold, green, red }: { label: string; value: string; bold?: boolean; green?: boolean; red?: boolean }) {
  return (
    <div className="flex justify-between items-center py-1 border-b border-gray-50 text-sm">
      <span className="text-gray-600">{label}</span>
      <span className={`${bold ? 'font-bold' : 'font-medium'} ${green ? 'text-green-700' : ''} ${red ? 'text-red-600' : ''} text-right`}>
        {value}
      </span>
    </div>
  )
}

export default function OpportunityDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [opp, setOpp] = useState<FullOpportunity | null>(null)
  const [loading, setLoading] = useState(true)
  const [matchLoading, setMatchLoading] = useState(false)
  const [updatingMatch, setUpdatingMatch] = useState<string | null>(null)

  // Adicionar investidor
  const [availableInvestors, setAvailableInvestors] = useState<{ id: string; name: string }[]>([])
  const [selectedInvestorId, setSelectedInvestorId] = useState('')
  const [capitalInput, setCapitalInput] = useState('')
  const [tipoAssociado, setTipoAssociado] = useState<'E' | 'P'>('E')
  const [addingInvestor, setAddingInvestor] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)

  const loadOpportunity = useCallback(async () => {
    const res = await fetch(`/api/opportunities/${id}`)
    if (!res.ok) { router.push('/dashboard/opportunities'); return }
    setOpp(await res.json())
    setLoading(false)
  }, [id, router])

  useEffect(() => { loadOpportunity() }, [loadOpportunity])

  useEffect(() => {
    fetch('/api/investors?status=active').then((r) => r.json()).then((data) => {
      if (Array.isArray(data)) setAvailableInvestors(data.map((i: { id: string; name: string }) => ({ id: i.id, name: i.name })))
    })
  }, [])

  async function runMatchingAgent() {
    setMatchLoading(true)
    const res = await fetch('/api/agents/investor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ opportunity_id: id }),
    })
    const data = await res.json()
    if (!res.ok) { toast.error(data.error || 'Erro no agente'); setMatchLoading(false); return }
    toast.success(`${data.matches_count} investidores encontrados!`)
    await loadOpportunity()
    setMatchLoading(false)
  }

  async function updateMatchStatus(matchId: string, status: string) {
    setUpdatingMatch(matchId)
    const res = await fetch(`/api/matches?id=${matchId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    if (res.ok) { await loadOpportunity(); toast.success('Estado atualizado') }
    setUpdatingMatch(null)
  }

  async function addDealInvestor() {
    if (!selectedInvestorId || !capitalInput) { toast.error('Seleciona investidor e capital'); return }
    setAddingInvestor(true)
    const res = await fetch(`/api/opportunities/${id}/investors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ investor_id: selectedInvestorId, capital_invested: parseInt(capitalInput), tipo_associado: tipoAssociado }),
    })
    const data = await res.json()
    if (!res.ok) { toast.error(data.error || 'Erro'); setAddingInvestor(false); return }
    toast.success('Investidor adicionado!')
    setSelectedInvestorId(''); setCapitalInput(''); setShowAddForm(false)
    await loadOpportunity()
    setAddingInvestor(false)
  }

  async function removeInvestor(investorId: string) {
    const res = await fetch(`/api/opportunities/${id}/investors?investor_id=${investorId}`, { method: 'DELETE' })
    if (res.ok) { toast.success('Removido'); await loadOpportunity() }
  }

  if (loading) return <div className="p-6 text-gray-400">A carregar...</div>
  if (!opp) return null

  const isFF = opp.deal_type === 'fix_and_flip'
  const roi = !isFF ? calcularRoi(opp) : null
  const ff = isFF ? calcularFixFlip(opp) : null
  const preco = opp.negotiated_price ?? opp.asking_price

  // totalCapital = capital total do negócio (base para % de cada investidor)
  // A % de cada investidor = capital_invested / capital_proprio_necessario
  const totalCapital = ff ? ff.capital_proprio_necessario : opp.deal_investors.reduce((s, di) => s + di.capital_invested, 0)
  // totalContributed = soma do capital já comprometido pelos investidores (para mostrar progresso)
  const totalContributed = opp.deal_investors.reduce((s, di) => s + di.capital_invested, 0)

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/opportunities" className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1">
            <ArrowLeft size={14} />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-gray-900">{opp.title}</h1>
            <div className="flex items-center gap-2 mt-0.5">
              <Badge className={STATUS_COLORS[opp.status]}>{OPPORTUNITY_STATUS_LABELS[opp.status]}</Badge>
              <span className="text-sm text-gray-500">{opp.zone}{opp.typology ? ` · ${opp.typology}` : ''}</span>
              <Badge variant="outline" className="text-xs">{isFF ? 'Fix & Flip' : 'Buy-to-Let'}</Badge>
            </div>
          </div>
        </div>
        <Button onClick={runMatchingAgent} disabled={matchLoading} className="gap-2" size="sm">
          {matchLoading ? <RefreshCw size={14} className="animate-spin" /> : <Bot size={14} />}
          {matchLoading ? 'A analisar...' : 'Encontrar Investidores'}
        </Button>
      </div>

      {/* ══ BUY-TO-LET ══ */}
      {!isFF && roi && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card>
            <CardHeader><CardTitle className="text-sm text-gray-500 uppercase tracking-wide">Preço</CardTitle></CardHeader>
            <CardContent className="text-sm space-y-1">
              <Row label="Preço pedido" value={formatEur(opp.asking_price)} />
              {opp.negotiated_price && <Row label="Negociado" value={formatEur(opp.negotiated_price)} bold green />}
              {opp.renovation_cost > 0 && <Row label="Obras" value={formatEur(opp.renovation_cost)} />}
            </CardContent>
          </Card>
          <Card className="border-green-200">
            <CardHeader><CardTitle className="text-sm text-green-700 flex items-center gap-2"><TrendingUp size={14} />ROI</CardTitle></CardHeader>
            <CardContent className="text-sm space-y-1">
              <Row label="Yield Bruto" value={formatPct(roi.yield_bruto)} bold green />
              <Row label="Yield Líquido" value={formatPct(roi.yield_liquido)} bold />
              {opp.estimated_monthly_rent && <Row label="Renda mensal" value={formatEur(opp.estimated_monthly_rent)} />}
              <Row label="Cash Flow Anual" value={formatEur(roi.cash_flow_anual)} green={roi.cash_flow_anual >= 0} red={roi.cash_flow_anual < 0} />
              {roi.payback_anos && <Row label="Payback" value={`${roi.payback_anos} anos`} />}
              <Row label="Capital total" value={formatEur(roi.capital_total_investido)} bold />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-sm">
              {opp.description && <p className="text-gray-700">{opp.description}</p>}
              <p className="text-xs text-gray-400 mt-2">Fonte: {opp.source ?? 'N/D'}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ══ FIX & FLIP — Layout 3 colunas igual à folha ══ */}
      {isFF && ff && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* ── Coluna Esquerda: Inputs ── */}
          <div className="space-y-3">
            <Card>
              <CardHeader className="pb-1"><CardTitle className="text-xs text-gray-500 uppercase tracking-wide">Aquisição</CardTitle></CardHeader>
              <CardContent className="text-sm space-y-0.5">
                <Row label="Preço de Aquisição" value={formatEur(opp.asking_price)} />
                {opp.vpt && <Row label="VPT" value={formatEur(opp.vpt)} />}
                {opp.negotiated_price && <Row label="Preço negociado" value={formatEur(opp.negotiated_price)} bold green />}
                <Row label="Preço estimado de Venda" value={opp.estimated_sell_price ? formatEur(opp.estimated_sell_price) : 'N/D'} bold />
                <Row label="IMT + IS" value={formatEur(ff.imt + ff.imposto_selo)} />
                <Row label="Escritura / DPA" value={formatEur(ff.escritura)} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-1"><CardTitle className="text-xs text-gray-500 uppercase tracking-wide">Financiamento</CardTitle></CardHeader>
              <CardContent className="text-sm space-y-0.5">
                <Row label="Entrada" value={`${opp.financing_entry_pct ?? 100}%`} />
                <Row label="Taxa de Juro" value={opp.financing_interest_pct ? `${opp.financing_interest_pct}%` : '—'} />
                <Row label="Prazo" value={opp.financing_years ? `${opp.financing_years} anos` : '—'} />
                <Row label="Prestação mensal" value={ff.prestacao_mensal > 0 ? formatEur(ff.prestacao_mensal) : '0,00 €'} />
                <Row label="Total Custos c/Financiamento" value={formatEur(ff.total_custos_financiamento)} bold />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-1"><CardTitle className="text-xs text-gray-500 uppercase tracking-wide">Custos Transitórios</CardTitle></CardHeader>
              <CardContent className="text-sm space-y-0.5">
                <Row label="Nº meses em posse" value={`${opp.holding_months ?? 12}`} />
                <Row label="Seguros/mês" value={formatEur(opp.insurance_monthly ?? 0)} />
                <Row label="Condomínio/mês" value={formatEur(opp.condo_fee ?? 0)} />
                <Row label="Eletricidade/mês" value={formatEur(opp.electricity_monthly ?? 0)} />
                <Row label="Água/mês" value={formatEur(opp.water_monthly ?? 0)} />
                <Row label="Total Custos Transitórios" value={formatEur(ff.total_custos_transitorios)} bold />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-1"><CardTitle className="text-xs text-gray-500 uppercase tracking-wide">Obras</CardTitle></CardHeader>
              <CardContent className="text-sm space-y-0.5">
                <Row label="Empreitada" value={formatEur(opp.construction_cost ?? 0)} />
                <Row label="Despesas Operacionais" value={formatEur(opp.operational_expenses ?? 0)} />
                {(opp.renovation_item3 ?? 0) > 0 && <Row label="Rúbrica 3" value={formatEur(opp.renovation_item3 ?? 0)} />}
                {(opp.renovation_item4 ?? 0) > 0 && <Row label="Rúbrica 4" value={formatEur(opp.renovation_item4 ?? 0)} />}
                {(opp.renovation_item5 ?? 0) > 0 && <Row label="Rúbrica 5" value={formatEur(opp.renovation_item5 ?? 0)} />}
                <Row label="Total Obras" value={formatEur(ff.total_obras)} bold />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-1"><CardTitle className="text-xs text-gray-500 uppercase tracking-wide">Custos com Venda</CardTitle></CardHeader>
              <CardContent className="text-sm space-y-0.5">
                <Row label={`Comissão imobiliária (${opp.sale_commission_pct ?? 4}% + IVA)`} value={formatEur(ff.comissao1)} />
                {ff.comissao2 > 0 && <Row label="Comissão 2" value={formatEur(ff.comissao2)} />}
                {ff.comissao3 > 0 && <Row label="Comissão 3" value={formatEur(ff.comissao3)} />}
                {ff.penalizacao > 0 && <Row label="Penalização amortização" value={formatEur(ff.penalizacao)} />}
                <Row label="Total Custos com Venda" value={formatEur(ff.total_custos_venda)} bold />
              </CardContent>
            </Card>
          </div>

          {/* ── Coluna Central: Resumo e Rentabilidade ── */}
          <div className="space-y-3">
            <Card>
              <CardHeader className="pb-1"><CardTitle className="text-sm font-bold">Resumo do Negócio</CardTitle></CardHeader>
              <CardContent className="text-sm space-y-0.5">
                <Row label="Preço da Aquisição" value={formatEur(preco)} />
                <Row label="Custos com Aquisição" value={formatEur(ff.total_custos_aquisicao)} />
                <Row label="Custos com Financiamento" value={formatEur(ff.total_custos_financiamento)} />
                <Row label="Custos com as Obras" value={formatEur(ff.total_obras)} />
                <Row label="Custos com Venda do imóvel" value={formatEur(ff.total_custos_venda)} />
                <Row label="Custos Transitórios" value={formatEur(ff.total_custos_transitorios)} />
                <Row label="Custo total do negócio" value={formatEur(ff.custo_total_negocio)} bold />
                <Row label="Preço estimado de Venda" value={formatEur(ff.preco_venda)} bold />
              </CardContent>
            </Card>

            <Card className="border-orange-200 bg-orange-50">
              <CardHeader className="pb-1"><CardTitle className="text-sm font-bold text-orange-900">Análise de Rentabilidade</CardTitle></CardHeader>
              <CardContent className="text-sm space-y-0.5">
                <Row label="ROI Total" value={formatPct(ff.roi_total)} bold green />
                <Row label="Lucro líquido antes de impostos" value={formatEur(ff.lucro_liquido_antes_impostos)} bold green={ff.lucro_bruto >= 0} red={ff.lucro_bruto < 0} />
                <Row label="Retorno Cash-on-cash" value={formatPct(ff.cash_on_cash)} bold />
                <Row label="Capital próprio necessário" value={formatEur(ff.capital_proprio_necessario)} bold />
                <Row label="ROI Total Anualizado" value={formatPct(ff.roi_anualizado)} bold green />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-1"><CardTitle className="text-sm">Capital Investidor</CardTitle></CardHeader>
              <CardContent className="text-sm space-y-0.5">
                <Row label="Capital Investido" value={formatEur(ff.capital_proprio_necessario)} />
                <Row label="Lucro Bruto" value={formatEur(ff.lucro_bruto)} bold green={ff.lucro_bruto >= 0} />
                <Row label={`IRC (${opp.irc_rate ?? 19}%)`} value={formatEur(ff.irc_valor)} />
                <Row label="Lucro Líquido após IRC" value={formatEur(ff.lucro_liquido_irc)} bold />
              </CardContent>
            </Card>

            <Card className="bg-blue-50 border-blue-200">
              <CardHeader className="pb-1"><CardTitle className="text-sm text-blue-800">Partilha Operador</CardTitle></CardHeader>
              <CardContent className="text-sm">
                <Row label={`Resultado (${opp.operator_profit_pct ?? 25}% lucro líquido)`} value={formatEur(ff.operador_resultado)} bold />
                <Row label={`Investidores (${100 - (opp.operator_profit_pct ?? 25)}%)`} value={formatEur(ff.investidores_total_lucro)} bold green />
              </CardContent>
            </Card>
          </div>

          {/* ── Coluna Direita: Info imóvel + Investidores vs Capital ── */}
          <div className="space-y-3">
            {opp.area_m2 && (
              <Card>
                <CardHeader className="pb-1"><CardTitle className="text-xs text-gray-500 uppercase tracking-wide">Sobre o Imóvel</CardTitle></CardHeader>
                <CardContent className="text-sm space-y-0.5">
                  <Row label="Metros quadrados" value={`${opp.area_m2} m²`} />
                  {ff.valor_m2_compra && <Row label="Valor m² compra" value={formatEur(ff.valor_m2_compra)} />}
                  {ff.valor_m2_obra && <Row label="Valor m² obra" value={formatEur(ff.valor_m2_obra)} />}
                  {ff.valor_m2_venda && <Row label="Valor m² venda" value={formatEur(ff.valor_m2_venda)} />}
                </CardContent>
              </Card>
            )}

            {(opp.reform_months || opp.contract_type) && (
              <Card>
                <CardHeader className="pb-1"><CardTitle className="text-xs text-gray-500 uppercase tracking-wide">Detalhes de Reforma</CardTitle></CardHeader>
                <CardContent className="text-sm space-y-0.5">
                  {opp.reform_months && <Row label="Período (meses)" value={`${opp.reform_months}`} />}
                  {opp.contract_type && <Row label="Tipo de Contrato" value={opp.contract_type} />}
                  {opp.holding_months && <Row label="Compra-venda (meses)" value={`${opp.holding_months}`} />}
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader className="pb-1">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-xs text-gray-500 uppercase tracking-wide">Investidor vs Capital</CardTitle>
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setShowAddForm(!showAddForm)}>
                    <Plus size={12} className="mr-1" /> Adicionar
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="text-sm">
                {showAddForm && (
                  <div className="mb-3 p-2 bg-gray-50 rounded-lg space-y-2">
                    <Select value={selectedInvestorId} onValueChange={setSelectedInvestorId}>
                      <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Selecionar investidor" /></SelectTrigger>
                      <SelectContent>
                        {availableInvestors.map((inv) => (
                          <SelectItem key={inv.id} value={inv.id}>{inv.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="flex gap-2">
                      <Input type="number" placeholder="Capital (€)" value={capitalInput}
                        onChange={(e) => setCapitalInput(e.target.value)} className="h-7 text-xs flex-1" />
                      <Select value={tipoAssociado} onValueChange={(v) => setTipoAssociado(v as 'E' | 'P')}>
                        <SelectTrigger className="h-7 text-xs w-16"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="E">E</SelectItem>
                          <SelectItem value="P">P</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <Button size="sm" className="w-full h-7 text-xs" disabled={addingInvestor} onClick={addDealInvestor}>
                      {addingInvestor ? 'A adicionar...' : 'Confirmar'}
                    </Button>
                  </div>
                )}

                {opp.deal_investors.length === 0 ? (
                  <p className="text-gray-400 text-xs">Sem investidores alocados</p>
                ) : (
                  <div className="space-y-1">
                    {opp.deal_investors.map((di) => {
                      const inv = di.investors as { id: string; name: string } | null
                      const pct = totalCapital > 0 ? (di.capital_invested / totalCapital * 100).toFixed(1) : '0'
                      return (
                        <div key={di.id} className="flex items-center justify-between gap-2 py-0.5">
                          <div className="min-w-0">
                            <span className="font-medium text-xs">{inv?.name ?? '—'}</span>
                            <span className="text-gray-400 text-xs ml-1">({di.tipo_associado})</span>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <span className="text-xs text-gray-500">{pct}%</span>
                            <span className="text-xs font-medium">{formatEur(di.capital_invested)}</span>
                            <button
                              onClick={() => inv && removeInvestor(inv.id)}
                              className="text-red-400 hover:text-red-600"
                            >
                              <Trash2 size={11} />
                            </button>
                          </div>
                        </div>
                      )
                    })}
                    <div className="flex justify-between pt-1 border-t text-xs font-bold">
                      <span>Comprometido</span>
                      <span>{formatEur(totalContributed)}</span>
                    </div>
                    {ff && totalContributed < ff.capital_proprio_necessario && (
                      <div className="flex justify-between text-xs text-amber-600 font-medium">
                        <span>Em falta</span>
                        <span>{formatEur(ff.capital_proprio_necessario - totalContributed)}</span>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {opp.description && (
              <Card>
                <CardContent className="pt-3 text-sm text-gray-700">{opp.description}</CardContent>
              </Card>
            )}
          </div>
        </div>
      )}

      {/* ══ Tabela Resumo Investidores ══ */}
      {isFF && ff && opp.deal_investors.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Resumo Investidores — {formatPct(100)}</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-500 border-b">
                    <th className="text-left py-2 pr-4">Investidor</th>
                    <th className="text-center py-2 px-2">Tipo</th>
                    <th className="text-right py-2 px-2">Investimento</th>
                    <th className="text-right py-2 px-2">%</th>
                    <th className="text-right py-2 px-2">Lucro Líquido</th>
                    <th className="text-right py-2 px-2">Retenção</th>
                    <th className="text-right py-2 px-2">Valor a Receber</th>
                    <th className="text-right py-2 pl-2">Cash-on-Cash</th>
                  </tr>
                </thead>
                <tbody>
                  {opp.deal_investors.map((di) => {
                    const inv = di.investors as { name: string; phone: string | null; email: string | null } | null
                    const pct = totalCapital > 0 ? di.capital_invested / totalCapital : 0
                    const lucroInvestidor = Math.round(ff.investidores_total_lucro * pct)
                    const retencao = di.tipo_associado === 'P' ? Math.round(lucroInvestidor * 0.28) : Math.round(lucroInvestidor * 0.0701)
                    const valorReceber = lucroInvestidor - retencao
                    const cashOnCash = di.capital_invested > 0 ? ((di.capital_invested + valorReceber) / di.capital_invested - 1) * 100 : 0
                    return (
                      <tr key={di.id} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="py-2 pr-4">
                          <div className="font-medium">{inv?.name ?? '—'}</div>
                          {inv?.phone && (
                            <div className="flex items-center gap-1 text-xs text-gray-400">
                              <Phone size={9} /> {inv.phone}
                            </div>
                          )}
                        </td>
                        <td className="text-center px-2 text-gray-500">{di.tipo_associado}</td>
                        <td className="text-right px-2 font-medium">{formatEur(di.capital_invested)}</td>
                        <td className="text-right px-2 text-gray-500">{(pct * 100).toFixed(1)}%</td>
                        <td className="text-right px-2 font-medium text-green-700">{formatEur(lucroInvestidor)}</td>
                        <td className="text-right px-2 text-gray-500">{formatEur(retencao)}</td>
                        <td className="text-right px-2 font-bold">{formatEur(valorReceber)}</td>
                        <td className="text-right pl-2 font-bold text-blue-700">{formatPct(cashOnCash)}</td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="font-bold border-t-2 text-sm">
                    <td className="py-2 pr-4">Total</td>
                    <td />
                    <td className="text-right px-2">{formatEur(totalContributed)}</td>
                    <td className="text-right px-2">{totalCapital > 0 ? formatPct(totalContributed / totalCapital * 100) : '—'}</td>
                    <td className="text-right px-2 text-green-700">{formatEur(ff.investidores_total_lucro)}</td>
                    <td colSpan={3} />
                  </tr>
                  {totalContributed < totalCapital && (
                    <tr className="text-xs text-amber-600">
                      <td className="py-1 pr-4 font-medium">Capital em falta</td>
                      <td />
                      <td className="text-right px-2 font-medium">{formatEur(totalCapital - totalContributed)}</td>
                      <td colSpan={5} />
                    </tr>
                  )}
                </tfoot>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ══ Matches IA ══ */}
      {opp.matches.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Matches IA ({opp.matches.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {opp.matches.map((m) => {
                const inv = m.investors
                const nextMap: Record<string, string> = { suggested: 'presented', presented: 'interested', interested: 'invested' }
                const nextLabel: Record<string, string> = { suggested: 'Apresentado', presented: 'Interessado', interested: 'Investiu' }
                return (
                  <div key={m.id} className="flex items-start gap-3 p-3 rounded-lg border border-gray-100">
                    <div className="text-center flex-shrink-0 w-12">
                      <span className="text-2xl font-bold text-gray-900">{m.match_score}</span>
                      <p className="text-xs text-gray-400">/100</p>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Link href={`/dashboard/investors/${inv?.id}`} className="font-medium text-gray-900 hover:text-blue-600 text-sm">
                          {inv?.name ?? '—'}
                        </Link>
                        {inv?.phone && <a href={`tel:${inv.phone}`} className="text-xs text-gray-400 flex items-center gap-0.5"><Phone size={10} />{inv.phone}</a>}
                        {inv?.email && <a href={`mailto:${inv.email}`} className="text-xs text-gray-400 flex items-center gap-0.5"><Mail size={10} />{inv.email}</a>}
                        <Badge className={MATCH_COLORS[m.status]}>{MATCH_STATUS_LABELS[m.status]}</Badge>
                      </div>
                      <div className="flex gap-3 flex-wrap mb-1">
                        {m.match_reasons.slice(0, 3).map((r, i) => (
                          <div key={i} className="flex items-center gap-1 text-xs text-gray-600">
                            {r.positive ? <CheckCircle2 size={10} className="text-green-500" /> : <AlertCircle size={10} className="text-orange-400" />}
                            {r.reason}
                          </div>
                        ))}
                      </div>
                      {m.pitch_draft && (
                        <p className="text-xs text-blue-700 bg-blue-50 p-2 rounded mt-1">{m.pitch_draft}</p>
                      )}
                    </div>
                    {m.status !== 'rejected' && m.status !== 'invested' && (
                      <div className="flex flex-col gap-1 flex-shrink-0">
                        {nextMap[m.status] && (
                          <Button size="sm" variant="outline" className="text-xs h-7" disabled={updatingMatch === m.id}
                            onClick={() => updateMatchStatus(m.id, nextMap[m.status])}>
                            → {nextLabel[m.status]}
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" className="text-xs h-7 text-red-400" disabled={updatingMatch === m.id}
                          onClick={() => updateMatchStatus(m.id, 'rejected')}>
                          Rejeitar
                        </Button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
