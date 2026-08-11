-- ============================================================
-- Migration 032: embeddings semânticos para listings e lead_profiles
-- ============================================================
-- Camada semântica adicional ao motor de matching determinístico
-- (lib/listing-matching-engine.ts). Guarda o vector directamente nas
-- tabelas existentes (não cria tabela nova) — OpenAI text-embedding-3-small,
-- 1536 dimensões. Sem índice ivfflat/hnsw: à escala pessoal deste CRM os
-- listings já são todos carregados em memória por pedido (ver
-- app/api/leads/[id]/matches/route.ts), pelo que a similaridade é calculada
-- em TypeScript, não em SQL.

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE listings
  ADD COLUMN embedding            vector(1536),
  ADD COLUMN embedding_updated_at TIMESTAMPTZ;

ALTER TABLE lead_profiles
  ADD COLUMN embedding            vector(1536),
  ADD COLUMN embedding_updated_at TIMESTAMPTZ;
