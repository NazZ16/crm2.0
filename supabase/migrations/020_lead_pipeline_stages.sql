-- ============================================================
-- Migration 020: CPCV / Escriturado — sub-estados do pipeline
-- ============================================================
-- O negocio real passa por CPCV (Contrato de Promessa de Compra e Venda)
-- e Escritura antes de "Ganho". Ate agora tudo isso caia num unico
-- estado 'active'. As migrations 001-017 nao estao neste checkout
-- (gitignored), por isso o nome do CHECK constraint existente em
-- leads.status e desconhecido — localizamo-lo dinamicamente via
-- pg_constraint em vez de assumir um nome.

DO $$
DECLARE
  cname text;
BEGIN
  SELECT con.conname INTO cname
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_attribute att ON att.attrelid = rel.oid
  WHERE rel.relname = 'leads'
    AND con.contype = 'c'
    AND con.conname != 'leads_pkey'
    AND pg_get_constraintdef(con.oid) ILIKE '%status%'
  LIMIT 1;

  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE leads DROP CONSTRAINT %I', cname);
  END IF;

  ALTER TABLE leads ADD CONSTRAINT leads_status_check
    CHECK (status IN ('new','qualified','meeting','active','cpcv','escriturado','won','lost'));
END $$;

ALTER TABLE leads ADD COLUMN IF NOT EXISTS cpcv_date TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS escritura_date TIMESTAMPTZ;

COMMENT ON COLUMN leads.cpcv_date IS 'Data em que a lead entrou no estado cpcv (assinatura do CPCV).';
COMMENT ON COLUMN leads.escritura_date IS 'Data em que a lead entrou no estado escriturado (escritura assinada).';
