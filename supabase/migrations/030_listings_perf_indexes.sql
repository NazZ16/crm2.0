-- ============================================================
-- Migration 030: listings — índices de performance para a página
-- de imóveis (listagem + pesquisa)
-- ============================================================
-- A página /dashboard/listings ordena por team_id + created_at e faz
-- pesquisa ILIKE '%termo%' em title/reference/municipality/zone/address.
-- Sem estes índices, cada pedido força um sequential scan da tabela
-- inteira, o que piora à medida que o número de imóveis cresce.

CREATE INDEX idx_listings_team_created_at ON listings(team_id, created_at DESC);

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX idx_listings_title_trgm ON listings USING GIN (title gin_trgm_ops);
CREATE INDEX idx_listings_reference_trgm ON listings USING GIN (reference gin_trgm_ops);
CREATE INDEX idx_listings_municipality_trgm ON listings USING GIN (municipality gin_trgm_ops);
CREATE INDEX idx_listings_zone_trgm ON listings USING GIN (zone gin_trgm_ops);
CREATE INDEX idx_listings_address_trgm ON listings USING GIN (address gin_trgm_ops);
