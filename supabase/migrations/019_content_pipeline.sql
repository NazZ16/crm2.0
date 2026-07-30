-- ============================================================
-- Migration 019: content_pieces — pipeline de conteudo (marca pessoal)
-- ============================================================
-- Fluxo: Ideia -> Rascunho -> Agendado -> Publicado (ou Arquivado a
-- qualquer momento). Peca pode nascer manualmente na UI ou via captura
-- do Elsio Hub (Telegram) atraves da tool capture_content_idea.

CREATE TABLE content_pieces (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id        UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  platform       TEXT NOT NULL DEFAULT 'other'
                   CHECK (platform IN ('linkedin','instagram','tiktok','youtube','blog','other')),
  status         TEXT NOT NULL DEFAULT 'idea'
                   CHECK (status IN ('idea','draft','scheduled','published','archived')),
  idea_text      TEXT,           -- nota original (Hub ou manual)
  draft_content  TEXT,           -- copy editavel
  scheduled_at   TIMESTAMPTZ,    -- calendario editorial
  published_at   TIMESTAMPTZ,
  published_url  TEXT,
  source         TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','hub_telegram')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_content_pieces_team_status ON content_pieces(team_id, status);
CREATE INDEX idx_content_pieces_team_scheduled ON content_pieces(team_id, scheduled_at);

CREATE TRIGGER content_pieces_updated_at
  BEFORE UPDATE ON content_pieces
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── RLS ──────────────────────────────────────────────────────
ALTER TABLE content_pieces ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team sees content"
  ON content_pieces FOR SELECT USING (team_id = auth_team_id());
CREATE POLICY "agents can manage content"
  ON content_pieces FOR ALL USING (team_id = auth_team_id() AND auth_has_role('agent'));

-- Nota: /api/content e /api/query/content-pipeline tambem aceitam o
-- service-role key do Hub (header x-hub-secret, ver lib/hub-auth.ts),
-- que bypassa RLS tal como acontece com hub_chats (migration 018).
