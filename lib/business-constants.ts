// lib/business-constants.ts
// Constantes de negocio partilhadas entre o dashboard e as query routes do Hub.
// Antes duplicadas em app/dashboard/page.tsx e app/api/query/revenue-summary/route.ts.

// Objectivo de faturacao anual (KPI principal). Hardcoded por agora;
// idealmente viria de team settings (proxima iteracao).
export const YEARLY_REVENUE_TARGET_EUR = 50_000

// Probabilidades de fecho ponderadas por estado da pipeline.
// Conservador: ajusta-se com dados reais com o tempo.
export const PIPELINE_PROBABILITIES: Record<string, number> = {
  qualified: 0.10,
  meeting: 0.30,
  active: 0.60,
  cpcv: 0.80,
  escriturado: 0.95,
}
