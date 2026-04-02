-- ============================================================
-- Migration 009: API Keys por equipa (para scraper/N8N)
-- ============================================================

CREATE TABLE team_api_keys (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id     UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  label       TEXT NOT NULL,
  key_hash    TEXT NOT NULL UNIQUE,
  key_prefix  TEXT NOT NULL,
  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  last_used_at TIMESTAMPTZ,
  revoked_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_team_api_keys_team_id ON team_api_keys(team_id);
CREATE INDEX idx_team_api_keys_key_hash ON team_api_keys(key_hash);

ALTER TABLE team_api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins manage api keys"
  ON team_api_keys FOR ALL
  USING (team_id = auth_team_id() AND auth_has_role('admin'))
  WITH CHECK (team_id = auth_team_id() AND auth_has_role('admin'));
