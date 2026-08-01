-- ============================================================
-- Migration 025: listings.agent_* — informação do agente angariador
-- ============================================================
-- Quando o imóvel vem de outra agência (ex.: Maxwork), o agente
-- responsável pela angariação não é o utilizador do CRM — precisamos
-- de guardar o contacto dele para se poder falar diretamente com
-- quem tem o imóvel.

ALTER TABLE listings
  ADD COLUMN agent_name  TEXT,
  ADD COLUMN agent_phone TEXT,
  ADD COLUMN agent_email TEXT;
