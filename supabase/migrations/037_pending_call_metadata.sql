-- ============================================================
-- Migration 037: pending_call_metadata — correlacionar chamada real
-- (nome/telefone do telemóvel) com a transcrição do Plaud (Zapier)
-- ============================================================
-- A app GravadorChamadas no telemóvel sabe quem ligou (Contactos do
-- Android) mas não consegue gravar áudio (o Android/Pixel bloqueia
-- MIC/VOICE_COMMUNICATION durante uma chamada real para apps de
-- terceiros — ver tasks/lessons.md). O Plaud grava e transcreve, mas
-- não sabe quem é o contacto (chega via Zapier só com título/resumo/
-- transcrição, sem ID de chamada).
--
-- Esta tabela guarda o nome/telefone reais numa janela curta depois de
-- cada chamada. Quando a transcrição do Plaud chega a /api/ingest
-- (contentType='transcript'), o endpoint procura a entrada não
-- combinada mais recente desta equipa e usa o nome/telefone dela como
-- knownContactName/knownPhone (ver lib/call-pipeline.ts).

CREATE TABLE pending_call_metadata (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id        UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  contact_name   TEXT,
  phone          TEXT,
  call_ended_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  matched        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pending_call_metadata_lookup
  ON pending_call_metadata (team_id, matched, call_ended_at DESC);

-- ─── RLS ──────────────────────────────────────────────────────
-- So o /api/ingest (service role) le/escreve esta tabela; RLS aqui e so
-- defesa em profundidade, no mesmo padrao das outras tabelas de ingestao.
ALTER TABLE pending_call_metadata ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team sees pending_call_metadata"
  ON pending_call_metadata FOR SELECT USING (team_id = auth_team_id());
CREATE POLICY "agents can manage pending_call_metadata"
  ON pending_call_metadata FOR ALL USING (team_id = auth_team_id() AND auth_has_role('agent'));
