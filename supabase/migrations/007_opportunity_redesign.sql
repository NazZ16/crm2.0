-- ============================================================
-- Migration 007: Opportunity Redesign — Dois modos (buy_to_let + fix_and_flip)
-- ============================================================

-- ─── Adicionar campos fix & flip à tabela opportunities ──────
ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS deal_type TEXT DEFAULT 'buy_to_let'
    CHECK (deal_type IN ('buy_to_let', 'fix_and_flip')),
  ADD COLUMN IF NOT EXISTS area_m2 INTEGER,
  ADD COLUMN IF NOT EXISTS vpt INTEGER,

  -- Aquisição detalhada
  ADD COLUMN IF NOT EXISTS imposto_selo_pct NUMERIC(5,4) DEFAULT 0.008,
  ADD COLUMN IF NOT EXISTS escritura_cost INTEGER DEFAULT 1000,

  -- Financiamento
  ADD COLUMN IF NOT EXISTS financing_entry_pct NUMERIC(5,2) DEFAULT 100,
  ADD COLUMN IF NOT EXISTS financing_interest_pct NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS financing_years INTEGER,
  ADD COLUMN IF NOT EXISTS financing_stamp_duty_pct NUMERIC(5,4) DEFAULT 0.006,
  ADD COLUMN IF NOT EXISTS financing_dossier INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS financing_evaluation INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS financing_formalization INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS financing_mortgage_registry INTEGER DEFAULT 0,

  -- Custos transitórios
  ADD COLUMN IF NOT EXISTS holding_months INTEGER DEFAULT 12,
  ADD COLUMN IF NOT EXISTS insurance_monthly INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS electricity_monthly INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS water_monthly INTEGER DEFAULT 0,

  -- Obras detalhadas (construction_cost substitui renovation_cost para fix & flip)
  ADD COLUMN IF NOT EXISTS construction_cost INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS operational_expenses INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS renovation_item3 INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS renovation_item4 INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS renovation_item5 INTEGER DEFAULT 0,

  -- Custos de venda
  ADD COLUMN IF NOT EXISTS sale_commission_pct NUMERIC(5,2) DEFAULT 4,
  ADD COLUMN IF NOT EXISTS sale_commission2_pct NUMERIC(5,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sale_commission3_pct NUMERIC(5,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS early_repayment_penalty_pct NUMERIC(5,2) DEFAULT 0,

  -- Split e impostos
  ADD COLUMN IF NOT EXISTS operator_profit_pct NUMERIC(5,2) DEFAULT 25,
  ADD COLUMN IF NOT EXISTS irc_rate NUMERIC(5,2) DEFAULT 19,
  ADD COLUMN IF NOT EXISTS reform_months INTEGER,
  ADD COLUMN IF NOT EXISTS contract_type TEXT;

-- ─── opportunity_investors ─────────────────────────────────────
-- Investidores realmente alocados num deal (diferente de investor_matches que são sugestões IA)
CREATE TABLE opportunity_investors (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id         UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  opportunity_id  UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  investor_id     UUID NOT NULL REFERENCES investors(id) ON DELETE CASCADE,
  capital_invested INTEGER NOT NULL CHECK (capital_invested > 0),
  pct_share       NUMERIC(6,3),              -- % calculado do capital total
  tipo_associado  TEXT DEFAULT 'E' CHECK (tipo_associado IN ('E','P')),
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(opportunity_id, investor_id)
);

CREATE INDEX idx_opp_investors_opportunity_id ON opportunity_investors(opportunity_id);
CREATE INDEX idx_opp_investors_investor_id ON opportunity_investors(investor_id);
CREATE INDEX idx_opp_investors_team_id ON opportunity_investors(team_id);

CREATE TRIGGER opportunity_investors_updated_at
  BEFORE UPDATE ON opportunity_investors
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE opportunity_investors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team_isolation" ON opportunity_investors
  USING (team_id = auth_team_id())
  WITH CHECK (team_id = auth_team_id());
