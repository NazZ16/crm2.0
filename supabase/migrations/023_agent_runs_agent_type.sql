-- ============================================================
-- Migration 023: agent_runs.agent_type — inclui 'investor' e 'orientator'
-- ============================================================
-- O codigo ja insere agent_type='investor' (/api/agents/investor/route.ts)
-- e 'orientator' (app/dashboard/page.tsx, /api/agents/orientator/route.ts),
-- mas o CHECK constraint existente so permite 'lead','followup','coach',
-- 'marketing' — esses dois inserts falham em producao agora mesmo.
--
-- agent_type e TEXT com CHECK inline (nao ENUM, confirmado no schema real),
-- mas o nome exacto do constraint nao e conhecido neste checkout —
-- localiza-se dinamicamente em vez de assumir um nome.

DO $$
DECLARE
  cname text;
BEGIN
  SELECT con.conname INTO cname
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'agent_runs'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%agent_type%'
  LIMIT 1;

  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE agent_runs DROP CONSTRAINT %I', cname);
  END IF;

  ALTER TABLE agent_runs ADD CONSTRAINT agent_runs_agent_type_check
    CHECK (agent_type IN ('lead', 'followup', 'coach', 'marketing', 'investor', 'orientator'));
END $$;
