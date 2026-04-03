-- ============================================================
-- Migration 010: Pipeline de upload de chamadas (call_uploads)
-- ============================================================

CREATE TABLE call_uploads (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id          UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  lead_id          UUID REFERENCES leads(id) ON DELETE SET NULL,
  storage_path     TEXT NOT NULL,
  audio_duration_s INTEGER,
  transcript_text  TEXT,
  whisper_model    TEXT NOT NULL DEFAULT 'whisper-1',
  coach_feedback   JSONB,
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','transcribing','analyzing','done','failed')),
  error            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at     TIMESTAMPTZ
);

ALTER TABLE call_uploads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team members see own uploads"
  ON call_uploads FOR ALL
  USING (team_id = auth_team_id())
  WITH CHECK (team_id = auth_team_id());

CREATE INDEX idx_call_uploads_team_id ON call_uploads(team_id);
CREATE INDEX idx_call_uploads_lead_id ON call_uploads(lead_id);

CREATE INDEX idx_call_uploads_pending ON call_uploads(created_at)
  WHERE status IN ('pending', 'transcribing', 'analyzing');

CREATE INDEX idx_call_uploads_team_status ON call_uploads(team_id, status, created_at);
