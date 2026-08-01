-- ============================================================
-- Migration 024: listings — imóveis para venda/arrendamento
-- ============================================================
-- Diferente de "opportunities" (que é só para o módulo de investidores —
-- fix&flip / buy-to-let com ROI). "listings" guarda os imóveis normais
-- que o agente tem para vender/arrendar (próprios ou de angariação),
-- importados manualmente (colar texto/HTML do Maxwork, Idealista, etc.)
-- ou criados à mão, para depois dar match com leads compradores usando
-- lead_profiles.home_preferences / financial_profile.

CREATE TABLE listings (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id            UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  reference          TEXT,
  title              TEXT NOT NULL,
  business_type      TEXT NOT NULL DEFAULT 'venda' CHECK (business_type IN ('venda','arrendamento')),
  property_type      TEXT NOT NULL DEFAULT 'apartamento' CHECK (property_type IN (
                        'apartamento','moradia','terreno','comercial','garagem','outro'
                      )),
  typology           TEXT,
  price              NUMERIC,
  condo_fee          NUMERIC,
  imi_annual         NUMERIC,

  district           TEXT,
  municipality       TEXT,
  parish             TEXT,
  zone               TEXT,
  address            TEXT,
  zip_code           TEXT,
  latitude           NUMERIC,
  longitude          NUMERIC,

  area_useful_m2     NUMERIC,
  area_gross_m2      NUMERIC,
  area_plot_m2       NUMERIC,
  bedrooms           INTEGER,
  bathrooms          INTEGER,
  total_rooms        INTEGER,
  parking_spaces     INTEGER,
  has_elevator       BOOLEAN,
  construction_year  INTEGER,
  energy_rating      TEXT,

  features           TEXT[] NOT NULL DEFAULT '{}',
  description        TEXT,
  cover_image_url     TEXT,

  source             TEXT DEFAULT 'manual',
  source_url         TEXT,
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','reserved','sold','withdrawn')),
  lead_id            UUID REFERENCES leads(id) ON DELETE SET NULL,
  notes              TEXT,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_listings_team_status ON listings(team_id, status);
CREATE INDEX idx_listings_lead ON listings(lead_id);

CREATE TRIGGER listings_updated_at
  BEFORE UPDATE ON listings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── RLS ──────────────────────────────────────────────────────
ALTER TABLE listings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team sees listings"
  ON listings FOR SELECT USING (team_id = auth_team_id());
CREATE POLICY "agents can manage listings"
  ON listings FOR ALL USING (team_id = auth_team_id() AND auth_has_role('agent'));
