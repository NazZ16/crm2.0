-- ============================================================
-- Migration 003: Agent System (runs, learnings, uploads, extractions)
-- ============================================================

-- ─── agent_runs (audit log of every agent execution) ─────────
CREATE TABLE agent_runs (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id       UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  agent_type    TEXT NOT NULL CHECK (agent_type IN ('lead','followup','coach','marketing')),
  trigger_type  TEXT CHECK (trigger_type IN ('manual','n8n_cron','n8n_webhook')),
  lead_id       UUID REFERENCES leads(id) ON DELETE SET NULL,
  input_summary TEXT,
  output_json   JSONB,
  tokens_used   INTEGER,
  duration_ms   INTEGER,
  status        TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','done','failed')),
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_agent_runs_team_id ON agent_runs(team_id);
CREATE INDEX idx_agent_runs_agent_type ON agent_runs(team_id, agent_type);
CREATE INDEX idx_agent_runs_lead_id ON agent_runs(lead_id);
CREATE INDEX idx_agent_runs_created_at ON agent_runs(team_id, created_at DESC);

-- ─── agent_learnings (Coach Agent memory) ────────────────────
CREATE TABLE agent_learnings (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id          UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  learning_type    TEXT NOT NULL CHECK (learning_type IN ('conversion_pattern','objection','timing','source','behavior')),
  content          TEXT NOT NULL,
  evidence_json    JSONB,
  confidence       REAL NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
  times_confirmed  INTEGER NOT NULL DEFAULT 1,
  tags             TEXT[] DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_agent_learnings_team_id ON agent_learnings(team_id);
CREATE INDEX idx_agent_learnings_type ON agent_learnings(team_id, learning_type);

CREATE TRIGGER agent_learnings_updated_at
  BEFORE UPDATE ON agent_learnings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── conversation_uploads ─────────────────────────────────────
CREATE TABLE conversation_uploads (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id         UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  lead_id         UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('audio','text')),
  storage_path    TEXT,
  transcript_text TEXT,
  objective       TEXT,
  processed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_conversation_uploads_lead_id ON conversation_uploads(lead_id);
CREATE INDEX idx_conversation_uploads_team_id ON conversation_uploads(team_id);

-- ─── agent_extractions (full output of each lead analysis) ───
CREATE TABLE agent_extractions (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id              UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  lead_id              UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  upload_id            UUID REFERENCES conversation_uploads(id) ON DELETE SET NULL,
  run_id               UUID REFERENCES agent_runs(id) ON DELETE SET NULL,
  extracted_json       JSONB,
  recommendations_json JSONB,
  drafts_json          JSONB,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_agent_extractions_lead_id ON agent_extractions(lead_id);
CREATE INDEX idx_agent_extractions_team_id ON agent_extractions(team_id);

-- ─── RLS ──────────────────────────────────────────────────────
ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_learnings ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_extractions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team sees agent runs"
  ON agent_runs FOR SELECT USING (team_id = auth_team_id());
CREATE POLICY "agents can create runs"
  ON agent_runs FOR INSERT WITH CHECK (team_id = auth_team_id());
CREATE POLICY "agents can update runs"
  ON agent_runs FOR UPDATE USING (team_id = auth_team_id());

CREATE POLICY "team sees learnings"
  ON agent_learnings FOR SELECT USING (team_id = auth_team_id());
CREATE POLICY "agents can manage learnings"
  ON agent_learnings FOR ALL USING (team_id = auth_team_id() AND auth_has_role('agent'));

CREATE POLICY "team sees uploads"
  ON conversation_uploads FOR SELECT USING (team_id = auth_team_id());
CREATE POLICY "agents can create uploads"
  ON conversation_uploads FOR INSERT WITH CHECK (team_id = auth_team_id() AND auth_has_role('agent'));

CREATE POLICY "team sees extractions"
  ON agent_extractions FOR SELECT USING (team_id = auth_team_id());
CREATE POLICY "agents can create extractions"
  ON agent_extractions FOR INSERT WITH CHECK (team_id = auth_team_id() AND auth_has_role('agent'));
