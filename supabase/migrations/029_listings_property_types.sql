-- ============================================================
-- Migration 029: listings — mais tipos de imóvel (quinta, loja, armazém,
-- escritório, prédio)
-- ============================================================
-- Estes vinham antes todos colapsados em 'terreno'/'comercial' no scraper
-- da Maxwork, perdendo informação — e o colapso tinha um bug (mapeava
-- "quinta"/"loja"/"armazem"/"escritorio"/"predio" para eles mesmos em vez
-- de para um valor válido, rejeitado pelo CHECK constraint). Agora ficam
-- como tipos próprios.

ALTER TABLE listings DROP CONSTRAINT IF EXISTS listings_property_type_check;

ALTER TABLE listings ADD CONSTRAINT listings_property_type_check CHECK (property_type IN (
  'apartamento','moradia','terreno','comercial','garagem','outro',
  'quinta','loja','armazem','escritorio','predio'
));
