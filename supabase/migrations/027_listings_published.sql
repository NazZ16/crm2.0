-- ============================================================
-- Migration 027: listings.is_published — publicado no Maxwork ou não
-- ============================================================
-- Independente de status (ativo/reservado/vendido/retirado): um imóvel
-- pode estar ativo mas despublicado no site, ou vice-versa. Vem do
-- badge "Publicado"/"Não publicado" da ficha de cada imóvel no Maxwork.

ALTER TABLE listings
  ADD COLUMN is_published BOOLEAN;
