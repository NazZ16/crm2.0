-- ============================================================
-- Migration 004: Marketing Campaigns & Metrics
-- ============================================================

CREATE TYPE ad_platform AS ENUM ('meta','google','tiktok','organic','other');

-- ─── campaigns ───────────────────────────────────────────────
CREATE TABLE campaigns (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id      UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  platform     ad_platform NOT NULL,
  external_id  TEXT,
  name         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','ended')),
  budget_daily NUMERIC(10,2),
  budget_total NUMERIC(10,2),
  start_date   DATE,
  end_date     DATE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_campaigns_team_id ON campaigns(team_id);
CREATE INDEX idx_campaigns_platform ON campaigns(team_id, platform);

CREATE TRIGGER campaigns_updated_at
  BEFORE UPDATE ON campaigns
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── campaign_metrics (daily performance data) ────────────────
CREATE TABLE campaign_metrics (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id  UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  team_id      UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  date         DATE NOT NULL,
  spend        NUMERIC(10,2) NOT NULL DEFAULT 0,
  impressions  INTEGER NOT NULL DEFAULT 0,
  clicks       INTEGER NOT NULL DEFAULT 0,
  leads_count  INTEGER NOT NULL DEFAULT 0,
  cpl          NUMERIC(10,2),
  conversions  INTEGER NOT NULL DEFAULT 0,
  UNIQUE(campaign_id, date)
);

CREATE INDEX idx_campaign_metrics_campaign_id ON campaign_metrics(campaign_id);
CREATE INDEX idx_campaign_metrics_team_date ON campaign_metrics(team_id, date DESC);

-- Add campaign FK to leads table (now that campaigns exists)
ALTER TABLE leads ADD CONSTRAINT fk_leads_campaign
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE SET NULL;

-- ─── RLS ──────────────────────────────────────────────────────
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team sees campaigns"
  ON campaigns FOR SELECT USING (team_id = auth_team_id());
CREATE POLICY "agents can manage campaigns"
  ON campaigns FOR ALL USING (team_id = auth_team_id() AND auth_has_role('agent'));

CREATE POLICY "team sees campaign metrics"
  ON campaign_metrics FOR SELECT USING (team_id = auth_team_id());
CREATE POLICY "agents can manage metrics"
  ON campaign_metrics FOR ALL USING (team_id = auth_team_id() AND auth_has_role('agent'));
