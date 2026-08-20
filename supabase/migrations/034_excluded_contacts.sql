-- ============================================================
-- Migration 034: excluded_contacts — números excluídos da ingestão de WhatsApp
-- ============================================================
-- O telemóvel do utilizador é usado também para uso pessoal, por isso nem toda
-- mensagem de WhatsApp recebida é uma lead: contactos pessoais e colegas de
-- trabalho não devem virar lead, gerar interactions nem entrar nas análises
-- de IA. Verificado em lib/whatsapp-ingest.ts::resolveLeadAndLogMessage antes
-- de criar/atualizar lead — não há UI ainda, adiciona-se por SQL/Supabase
-- Studio (team_id, phone no mesmo formato normalizado usado em leads.phone,
-- ver lib/phone.ts).

CREATE TABLE excluded_contacts (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id    UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  phone      TEXT NOT NULL,
  reason     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_excluded_contacts_team_phone ON excluded_contacts(team_id, phone);

-- ─── RLS ──────────────────────────────────────────────────────
ALTER TABLE excluded_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team sees excluded_contacts"
  ON excluded_contacts FOR SELECT USING (team_id = auth_team_id());
CREATE POLICY "agents can manage excluded_contacts"
  ON excluded_contacts FOR ALL USING (team_id = auth_team_id() AND auth_has_role('agent'));
