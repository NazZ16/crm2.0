import type { Opportunity, RoiMetrics } from '@/lib/types'

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
