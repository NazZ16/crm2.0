-- ============================================================
-- Migration 020: CPCV / Escriturado — sub-estados do pipeline
-- ============================================================
-- O negocio real passa por CPCV (Contrato de Promessa de Compra e Venda)
-- e Escritura antes de "Ganho". Ate agora tudo isso caia num unico
-- estado 'active'.
--
-- leads.status usa o tipo ENUM nativo `lead_status` (nao um CHECK
-- constraint em TEXT) — confirmado no schema real (`status USER-DEFINED
-- NOT NULL DEFAULT 'new'::lead_status`). Novos valores tem de ser
-- adicionados ao tipo com ALTER TYPE ... ADD VALUE. Nao usamos os novos
-- valores em nenhum INSERT/UPDATE neste ficheiro — ALTER TYPE ADD VALUE
-- nao pode ser usado no mesmo bloco de transacao onde o novo valor e
-- lido/escrito.

ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'cpcv';
ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'escriturado';

ALTER TABLE leads ADD COLUMN IF NOT EXISTS cpcv_date TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS escritura_date TIMESTAMPTZ;

COMMENT ON COLUMN leads.cpcv_date IS 'Data em que a lead entrou no estado cpcv (assinatura do CPCV).';
COMMENT ON COLUMN leads.escritura_date IS 'Data em que a lead entrou no estado escriturado (escritura assinada).';
