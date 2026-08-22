-- ============================================================
-- Migration 036: listings — valor real de fecho e comprador
-- ============================================================
-- "price" é o valor pedido/anunciado. Quando um listing fecha (status
-- 'sold'), precisamos do valor real da transação e de quem foi o
-- comprador (lead), para reconciliar com leads.deal_value/closed_at
-- (migration 014) e ter uma base de valores reais de mercado — em vez
-- de só o pedido, que raramente é o valor final.

ALTER TABLE listings
  ADD COLUMN sold_price    NUMERIC,
  ADD COLUMN buyer_lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  ADD COLUMN sold_at       TIMESTAMPTZ;

CREATE INDEX idx_listings_buyer_lead ON listings(buyer_lead_id) WHERE buyer_lead_id IS NOT NULL;
