-- ============================================================
-- Migration 028: listings — sinais de mercado para triagem de negócio
-- ============================================================
-- Um imóvel há muito tempo no mercado sem visitas/propostas costuma ser
-- oportunidade de negociação. Vêm da ficha do imóvel no Maxwork
-- ("Dias no Mercado", "Visitas", "Propostas").

ALTER TABLE listings
  ADD COLUMN days_on_market INTEGER,
  ADD COLUMN visit_count    INTEGER,
  ADD COLUMN proposal_count INTEGER;
