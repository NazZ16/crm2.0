-- ============================================================
-- Migration 006: Investors, Opportunities, Matches
-- ============================================================

-- ─── investors ───────────────────────────────────────────────
CREATE TABLE investors (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id              UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name                 TEXT NOT NULL,
  email                TEXT,
  phone                TEXT,
  investment_type      TEXT[] DEFAULT '{}',      -- 'buy_to_let','buy_to_sell','fix_and_flip','commercial'
  budget_min           INTEGER,                   -- EUR
  budget_max           INTEGER,                   -- EUR
  preferred_zones      TEXT[] DEFAULT '{}',       -- ['Lisboa','Porto','Cascais']
  preferred_typologies TEXT[] DEFAULT '{}',       -- ['T1','T2','T3']
  min_yield            NUMERIC(5,2),              -- yield mínimo aceitável (%)
  risk_level           TEXT DEFAULT 'moderate' CHECK (risk_level IN ('conservative','moderate','aggressive')),
  investment_horizon   TEXT DEFAULT 'medium' CHECK (investment_horizon IN ('short','medium','long')),
  needs_financing      BOOLEAN DEFAULT false,
  max_renovation       TEXT DEFAULT 'light' CHECK (max_renovation IN ('none','light','medium','full')),
  notes                TEXT,
  status               TEXT DEFAULT 'active' CHECK (status IN ('active','inactive','invested')),
  last_contact         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_investors_team_id ON investors(team_id);
CREATE INDEX idx_investors_status ON investors(team_id, status);

CREATE TRIGGER investors_updated_at
  BEFORE UPDATE ON investors
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE investors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team_isolation" ON investors
  USING (team_id = auth_team_id())
  WITH CHECK (team_id = auth_team_id());

-- ─── opportunities ────────────────────────────────────────────
CREATE TABLE opportunities (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id               UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  title                 TEXT NOT NULL,
  address               TEXT,
  zone                  TEXT NOT NULL,
  typology              TEXT,                      -- 'T0','T1','T2','T3','T4+'
  property_type         TEXT DEFAULT 'apartment' CHECK (property_type IN ('apartment','house','commercial','land')),
  asking_price          INTEGER NOT NULL,           -- EUR
  negotiated_price      INTEGER,                    -- EUR
  estimated_monthly_rent INTEGER,                   -- EUR/mês (buy-to-let)
  condo_fee             INTEGER DEFAULT 0,          -- EUR/mês
  annual_imi            INTEGER DEFAULT 0,          -- EUR/ano
  renovation_cost       INTEGER DEFAULT 0,          -- EUR
  estimated_sell_price  INTEGER,                    -- EUR (buy-to-sell)
  status                TEXT DEFAULT 'analyzing' CHECK (status IN ('analyzing','available','under_offer','closed','passed')),
  source                TEXT,                       -- 'remax','era','particulares', etc.
  description           TEXT,
  lead_id               UUID REFERENCES leads(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_opportunities_team_id ON opportunities(team_id);
CREATE INDEX idx_opportunities_status ON opportunities(team_id, status);
CREATE INDEX idx_opportunities_zone ON opportunities(team_id, zone);

CREATE TRIGGER opportunities_updated_at
  BEFORE UPDATE ON opportunities
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE opportunities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team_isolation" ON opportunities
  USING (team_id = auth_team_id())
  WITH CHECK (team_id = auth_team_id());

-- ─── investor_matches ─────────────────────────────────────────
CREATE TABLE investor_matches (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id         UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  investor_id     UUID NOT NULL REFERENCES investors(id) ON DELETE CASCADE,
  opportunity_id  UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  match_score     INTEGER NOT NULL CHECK (match_score >= 0 AND match_score <= 100),
  match_reasons   JSONB DEFAULT '[]',               -- [{reason: string, positive: boolean}]
  ai_analysis     TEXT,
  pitch_draft     TEXT,
  status          TEXT DEFAULT 'suggested' CHECK (status IN ('suggested','presented','interested','rejected','invested')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(investor_id, opportunity_id)
);

CREATE INDEX idx_investor_matches_team_id ON investor_matches(team_id);
CREATE INDEX idx_investor_matches_opportunity_id ON investor_matches(opportunity_id);
CREATE INDEX idx_investor_matches_investor_id ON investor_matches(investor_id);
CREATE INDEX idx_investor_matches_status ON investor_matches(team_id, status);

CREATE TRIGGER investor_matches_updated_at
  BEFORE UPDATE ON investor_matches
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE investor_matches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team_isolation" ON investor_matches
  USING (team_id = auth_team_id())
  WITH CHECK (team_id = auth_team_id());
