-- ============================================================
-- Migration 018: hub_chats — historico conversacional do Hub
-- ============================================================
-- O Hub (elsio-hub Telegram) usa esta tabela para guardar mensagens da
-- conversacao por chat_id, permitindo multi-turno ("marca reuniao com X" ->
-- "que dia/hora?" -> "amanha 15h" -> agente cria evento).
--
-- Importante: esta tabela NAO esta ligada a leads/team_members. O Hub e um
-- sistema externo que usa a Supabase do CRM como backend partilhado.
-- A seguranca e via service-role key (Hub conhece, ninguem mais).

CREATE TABLE IF NOT EXISTS hub_chats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id BIGINT NOT NULL,                          -- Telegram chat ID
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
  content TEXT,                                     -- texto principal (NULL quando so houve tool_calls)
  tool_calls JSONB,                                 -- array de tool calls do assistant (Anthropic format)
  tool_use_id TEXT,                                 -- para mensagens role='tool' — id da call original
  tool_name TEXT,                                   -- nome da tool quando role='tool'
  tool_result JSONB,                                -- resultado da tool quando role='tool'
  metadata JSONB,                                   -- info extra: tokens, model, latency, intent inferido
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE hub_chats IS 'Historico conversacional do Elsio Hub. Cada linha e uma mensagem (user/assistant/tool result).';
COMMENT ON COLUMN hub_chats.chat_id IS 'Telegram chat ID. Usado para isolar conversas entre utilizadores.';
COMMENT ON COLUMN hub_chats.role IS 'user (mensagem do Elsio) | assistant (resposta do Claude, podendo conter tool_calls) | tool (resultado de execucao de tool)';

-- Indice principal: ler ultimas N mensagens de um chat ordenadas por tempo
CREATE INDEX IF NOT EXISTS idx_hub_chats_chat_id_created
  ON hub_chats(chat_id, created_at DESC);

-- RLS: nao habilitamos. So o service-role accede a esta tabela.
-- O Hub usa SUPABASE_SERVICE_ROLE_KEY que bypassa RLS.
