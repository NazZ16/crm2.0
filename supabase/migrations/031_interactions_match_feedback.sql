-- ============================================================
-- Migration 031: interactions — feedback estruturado de matches lead↔imóvel
-- ============================================================
-- Estende a tabela interactions já existente (não cria tabela nova) para
-- registar, quando uma interacção está associada a um imóvel sugerido, o
-- resultado (sugerido/visitado/proposta/rejeitado) e, quando rejeitado, o
-- motivo em categoria fechada. Alicerce para qualquer aprendizagem futura
-- sobre a qualidade dos matches — sem histórico de outcomes, não há como
-- ajustar scoring com base em resultados reais.

ALTER TABLE interactions
  ADD COLUMN listing_id       UUID REFERENCES listings(id) ON DELETE SET NULL,
  ADD COLUMN outcome          TEXT CHECK (outcome IN ('sugerido','visitado','proposta','rejeitado')),
  ADD COLUMN rejection_reason TEXT CHECK (rejection_reason IN (
                                 'preco','localizacao','estado_imovel','timing','tipologia','outro'
                               ));

-- rejection_reason só faz sentido quando outcome = 'rejeitado'.
ALTER TABLE interactions
  ADD CONSTRAINT interactions_rejection_reason_requires_outcome
  CHECK (rejection_reason IS NULL OR outcome = 'rejeitado');

CREATE INDEX idx_interactions_listing ON interactions(listing_id) WHERE listing_id IS NOT NULL;
