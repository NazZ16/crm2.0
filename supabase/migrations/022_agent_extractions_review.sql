-- ============================================================
-- Migration 022: agent_extractions — revisao antes de aplicar
-- ============================================================
-- Ate agora tanto a analise manual ("Analisar Conversa") como o
-- pipeline automatico de chamadas escreviam directamente no perfil
-- da lead e criavam tarefas sem revisao. Passa a ficar "pending" ate
-- o utilizador aplicar explicitamente (ver lib/apply-extraction.ts).

ALTER TABLE agent_extractions
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','applied','dismissed'));
ALTER TABLE agent_extractions ADD COLUMN IF NOT EXISTS applied_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_agent_extractions_pending
  ON agent_extractions(lead_id, status) WHERE status = 'pending';
