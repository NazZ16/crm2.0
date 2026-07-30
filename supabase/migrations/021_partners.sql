-- ============================================================
-- Migration 021: partners — diretorio de parceiros de confianca
-- ============================================================
-- Directorio de contactos profissionais usados no dia-a-dia
-- (intermediarios de credito, advogado, seguradora, empreiteiros...),
-- espelhando a pagina "Contatos" do Notion "Real Estate". Sem relacao
-- obrigatoria com leads/deals — e so um directorio de confianca.

CREATE TABLE partners (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id        UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  category       TEXT NOT NULL CHECK (category IN (
                    'credito','advogado','seguradora','fiscalizador','empreiteiro',
                    'eletricista','canalizador','pintor','eletrodomesticos','limpeza',
                    'transportadora','outro'
                  )),
  phone          TEXT,
  email          TEXT,
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_partners_team_category ON partners(team_id, category);

CREATE TRIGGER partners_updated_at
  BEFORE UPDATE ON partners
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── RLS ──────────────────────────────────────────────────────
ALTER TABLE partners ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team sees partners"
  ON partners FOR SELECT USING (team_id = auth_team_id());
CREATE POLICY "agents can manage partners"
  ON partners FOR ALL USING (team_id = auth_team_id() AND auth_has_role('agent'));
