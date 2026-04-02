-- ============================================================
-- Migration 008: lead_id em investors + source_url em opportunities
-- ============================================================

-- FK investors → leads
ALTER TABLE investors
  ADD COLUMN IF NOT EXISTS lead_id UUID REFERENCES leads(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_investors_lead_id ON investors(lead_id);

-- Scraping fields em opportunities
ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS source_url    TEXT,
  ADD COLUMN IF NOT EXISTS source_images TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS auto_imported BOOLEAN DEFAULT false;

-- Dedup: mesma URL não entra duas vezes para a mesma equipa
ALTER TABLE opportunities
  ADD CONSTRAINT opportunities_source_url_team
  UNIQUE (team_id, source_url);
