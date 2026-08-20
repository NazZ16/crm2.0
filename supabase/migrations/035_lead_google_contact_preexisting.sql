-- ============================================================
-- Migration 035: distinguir contactos Google pre-existentes dos criados pelo CRM
-- ============================================================
-- Quando o sync encontra um contacto Google que ja existia (mesmo telefone
-- guardado manualmente antes desta feature), o utilizador nao quer que o
-- nome/telefone/email sejam sobrescritos — so quer a informacao da lead
-- acrescentada a biografia. Contactos criados de raiz pelo CRM continuam a
-- ser mantidos totalmente sincronizados (nome/telefone/email/notas).

ALTER TABLE leads ADD COLUMN IF NOT EXISTS google_contact_preexisting BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN leads.google_contact_preexisting IS 'true se o contacto Google associado ja existia antes do sync (encontrado por telefone) — nesse caso so a biografia e atualizada, nome/telefone/email nunca sao alterados nem o contacto e apagado.';
