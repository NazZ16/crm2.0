-- ============================================================
-- Migration 026: listings.photos — todas as fotos do imóvel
-- ============================================================
-- cover_image_url guarda só a foto de capa (usada nas listagens).
-- photos guarda o álbum completo, para se poder percorrer todas as
-- fotos na ficha do imóvel e analisar o estado real do imóvel.

ALTER TABLE listings
  ADD COLUMN photos TEXT[] NOT NULL DEFAULT '{}';
