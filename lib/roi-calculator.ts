import type { Opportunity, RoiMetrics, FixFlipMetrics } from '@/lib/types'

/**
 * Tabela IMT 2024 para habitação própria permanente (Portugal)
 * Fonte: Autoridade Tributária e Aduaneira
 */
function calcularImt(preco: number): number {
  // Habitação — tabela I (residência permanente) 2024
  // Usar tabela II (outros) para simplificação de investimento
  const tabela = [
    { ate: 97064, taxa: 0, deducao: 0 },
    { ate: 132774, taxa: 0.02, deducao: 1941.28 },
    { ate: 181034, taxa: 0.05, deducao: 5924.50 },
    { ate: 301688, taxa: 0.07, deducao: 9545.18 },
    { ate: 603290, taxa: 0.08, deducao: 12562.06 },
    { ate: 1050400, taxa: 0.06, deducao: 0 },  // taxa única a partir daqui
    { ate: Infinity, taxa: 0.075, deducao: 0 },
  ]

  for (const escalao of tabela) {
    if (preco <= escalao.ate) {
      const imt = preco * escalao.taxa - escalao.deducao
      return Math.max(0, Math.round(imt))
    }
  }
  return Math.round(preco * 0.075)
}

/**
 * Calcula todas as métricas ROI para uma oportunidade de investimento imobiliário
 * em Portugal.
 */
export function calcularRoi(opp: Opportunity): RoiMetrics {
  const preco = opp.negotiated_price ?? opp.asking_price
  const rendaMensal = opp.estimated_monthly_rent ?? 0
  const condoMensal = opp.condo_fee ?? 0
  const imiAnual = opp.annual_imi ?? 0
  const renovacao = opp.renovation_cost ?? 0

  // Rendimento bruto anual
  const rendimentoAnual = rendaMensal * 12

  // Encargos anuais (condomínio + IMI + gestão estimada a 10% da renda)
  const gestaoAnual = rendimentoAnual * 0.1
  const encargosAnuais = condoMensal * 12 + imiAnual + gestaoAnual

  // Yields
  const yieldBruto = preco > 0 && rendimentoAnual > 0
    ? parseFloat(((rendimentoAnual / preco) * 100).toFixed(2))
    : 0

  const yieldLiquido = preco > 0 && rendimentoAnual > 0
    ? parseFloat((((rendimentoAnual - encargosAnuais) / preco) * 100).toFixed(2))
    : 0

  // Custos de aquisição
  const imt = calcularImt(preco)
  const custosEscritura = Math.round(preco * 0.015) // ~1.5%
  const capitalTotalInvestido = preco + imt + custosEscritura + renovacao

  // Cash flow anual líquido (sem prestação bancária, assumindo capital próprio)
  const cashFlowAnual = rendimentoAnual - encargosAnuais

  // Cash-on-cash (capital próprio total)
  const cashOnCash = capitalTotalInvestido > 0 && cashFlowAnual > 0
    ? parseFloat(((cashFlowAnual / capitalTotalInvestido) * 100).toFixed(2))
    : null

  // Payback
  const paybackAnos = capitalTotalInvestido > 0 && cashFlowAnual > 0
    ? parseFloat((capitalTotalInvestido / cashFlowAnual).toFixed(1))
    : null

  // Mais-valia estimada
  const plusValiaEstimada = opp.estimated_sell_price && opp.estimated_sell_price > preco
    ? parseFloat((((opp.estimated_sell_price - preco - imt - custosEscritura - renovacao) / capitalTotalInvestido) * 100).toFixed(2))
    : null

  return {
    preco_compra: preco,
    rendimento_anual: rendimentoAnual,
    encargos_anuais: Math.round(encargosAnuais),
    yield_bruto: yieldBruto,
    yield_liquido: yieldLiquido,
    imt,
    custos_escritura: custosEscritura,
    capital_total_investido: capitalTotalInvestido,
    cash_flow_anual: Math.round(cashFlowAnual),
    cash_on_cash: cashOnCash,
    payback_anos: paybackAnos,
    plus_valia_estimada: plusValiaEstimada,
  }
}

/**
 * Calcula PMT (prestação mensal) para financiamento bancário.
 * Fórmula: PMT = PV * [r(1+r)^n] / [(1+r)^n - 1]
 */
function calcPmt(principal: number, annualRate: number, years: number): number {
  if (annualRate === 0) return principal / (years * 12)
  const r = annualRate / 100 / 12
  const n = years * 12
  return (principal * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1)
}

/**
 * Calcula todas as métricas de análise para um negócio Fix & Flip.
 * Lógica baseada na folha de cálculo de análise do utilizador.
 */
export function calcularFixFlip(opp: Opportunity): FixFlipMetrics {
  const preco = opp.negotiated_price ?? opp.asking_price
  const sellPrice = opp.estimated_sell_price ?? 0
  const entryPct = opp.financing_entry_pct ?? 100
  const financingAmount = preco * (1 - entryPct / 100)

  // ─── Custos de Aquisição ─────────────────────────────────────
  const baseImt = opp.vpt && opp.vpt > 0 && opp.vpt < preco ? opp.vpt : preco
  const imt = calcularImt(baseImt)
  const impostoSelo = Math.round(preco * (opp.imposto_selo_pct ?? 0.008))
  const escritura = opp.escritura_cost ?? 1000
  const totalCustosAquisicao = imt + impostoSelo + escritura

  // ─── Financiamento ────────────────────────────────────────────
  let prestacaoMensal = 0
  let totalJuros = 0
  let isFinanciamento = 0
  if (financingAmount > 0 && opp.financing_interest_pct && opp.financing_years) {
    prestacaoMensal = calcPmt(financingAmount, opp.financing_interest_pct, opp.financing_years)
    totalJuros = Math.round(prestacaoMensal * opp.financing_years * 12 - financingAmount)
    isFinanciamento = Math.round(financingAmount * (opp.financing_stamp_duty_pct ?? 0.006))
  }
  const totalCustosFinanciamento = totalJuros + isFinanciamento
    + (opp.financing_dossier ?? 0)
    + (opp.financing_evaluation ?? 0)
    + (opp.financing_formalization ?? 0)
    + (opp.financing_mortgage_registry ?? 0)

  // ─── Obras ────────────────────────────────────────────────────
  const totalObras = (opp.construction_cost ?? 0)
    + (opp.operational_expenses ?? 0)
    + (opp.renovation_item3 ?? 0)
    + (opp.renovation_item4 ?? 0)
    + (opp.renovation_item5 ?? 0)

  // ─── Custos Transitórios ─────────────────────────────────────
  const holdingMonths = opp.holding_months ?? 12
  const mensaisTransitorios = (opp.insurance_monthly ?? 0)
    + (opp.condo_fee ?? 0)
    + (opp.electricity_monthly ?? 0)
    + (opp.water_monthly ?? 0)
  const totalCustosTransitorios = Math.round(mensaisTransitorios * holdingMonths + totalJuros)

  // ─── Custos de Venda ─────────────────────────────────────────
  const comissao1 = sellPrice > 0 ? Math.round(sellPrice * (opp.sale_commission_pct ?? 4) / 100 * 1.23) : 0
  const comissao2 = sellPrice > 0 ? Math.round(sellPrice * (opp.sale_commission2_pct ?? 0) / 100 * 1.23) : 0
  const comissao3 = sellPrice > 0 ? Math.round(sellPrice * (opp.sale_commission3_pct ?? 0) / 100 * 1.23) : 0
  const penalizacao = financingAmount > 0 ? Math.round(financingAmount * (opp.early_repayment_penalty_pct ?? 0) / 100) : 0
  const totalCustosVenda = comissao1 + comissao2 + comissao3 + penalizacao

  // ─── Resumo do Negócio ───────────────────────────────────────
  const custoTotalNegocio = preco + totalCustosAquisicao + totalCustosFinanciamento
    + totalObras + totalCustosTransitorios + totalCustosVenda

  const lucroBruto = sellPrice > 0 ? sellPrice - custoTotalNegocio : 0
  const lucroLiquidoAntesImpostos = lucroBruto  // antes de IRC

  // ─── Capital Próprio Necessário ───────────────────────────────
  // = entrada + custos aquisição + obras + transitórios + venda (tudo exceto financiamento bancário)
  const capitalProprio = Math.round(
    preco * (entryPct / 100)
    + totalCustosAquisicao
    + totalObras
    + totalCustosTransitorios
    + totalCustosVenda
  )

  // ─── Rentabilidade ────────────────────────────────────────────
  const roiTotal = custoTotalNegocio > 0 ? parseFloat(((lucroBruto / custoTotalNegocio) * 100).toFixed(2)) : 0
  const contractMonths = opp.reform_months ?? holdingMonths
  const roiAnualizado = contractMonths > 0
    ? parseFloat((roiTotal / (contractMonths / 12)).toFixed(2))
    : roiTotal
  const cashOnCash = capitalProprio > 0
    ? parseFloat(((lucroBruto / capitalProprio) * 100).toFixed(2))
    : 0

  // ─── IRC + Split ──────────────────────────────────────────────
  const ircRate = (opp.irc_rate ?? 19) / 100
  const ircValor = lucroBruto > 0 ? Math.round(lucroBruto * ircRate) : 0
  const lucroLiquidoIrc = lucroBruto - ircValor
  const operatorPct = (opp.operator_profit_pct ?? 25) / 100
  const operadorResultado = Math.round(lucroLiquidoIrc * operatorPct)
  const investidoresTotalLucro = Math.round(lucroLiquidoIrc * (1 - operatorPct))

  // ─── Por m2 ───────────────────────────────────────────────────
  const area = opp.area_m2 ?? null

  return {
    imt,
    imposto_selo: impostoSelo,
    escritura,
    total_custos_aquisicao: totalCustosAquisicao,
    financing_amount: Math.round(financingAmount),
    prestacao_mensal: Math.round(prestacaoMensal),
    total_juros: totalJuros,
    is_financiamento: isFinanciamento,
    total_custos_financiamento: totalCustosFinanciamento,
    total_obras: totalObras,
    total_custos_transitorios: totalCustosTransitorios,
    comissao1,
    comissao2,
    comissao3,
    penalizacao,
    total_custos_venda: totalCustosVenda,
    custo_total_negocio: Math.round(custoTotalNegocio),
    preco_venda: sellPrice,
    lucro_bruto: Math.round(lucroBruto),
    lucro_liquido_antes_impostos: Math.round(lucroLiquidoAntesImpostos),
    roi_total: roiTotal,
    roi_anualizado: roiAnualizado,
    cash_on_cash: cashOnCash,
    capital_proprio_necessario: capitalProprio,
    irc_valor: ircValor,
    lucro_liquido_irc: Math.round(lucroLiquidoIrc),
    operador_resultado: operadorResultado,
    investidores_total_lucro: investidoresTotalLucro,
    valor_m2_compra: area ? Math.round(preco / area) : null,
    valor_m2_obra: area ? Math.round(totalObras / area) : null,
    valor_m2_venda: area && sellPrice > 0 ? Math.round(sellPrice / area) : null,
  }
}

/** Formata um valor em EUR */
export function formatEur(value: number): string {
  return new Intl.NumberFormat('pt-PT', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(value)
}

/** Formata uma percentagem */
export function formatPct(value: number): string {
  return `${value.toFixed(2)}%`
}
