-- ============================================================
-- Migration 029: listings — índice único (team_id, source_url)
-- ============================================================
-- Até agora o dedup por source_url era só "SELECT depois INSERT/UPDATE"
-- em app/api/listings/route.ts — sujeito a corrida se dois pedidos
-- chegarem em paralelo (relevante agora que o scraper passa a enviar
-- em lote). Este índice único parcial é o backstop a nível de BD.
--
-- Antes de criar o índice, remove duplicados que possam já existir
-- (mantém a linha mais recentemente atualizada de cada par
-- team_id+source_url, apaga as restantes).

DELETE FROM listings a
USING listings b
WHERE a.team_id = b.team_id
  AND a.source_url = b.source_url
  AND a.source_url IS NOT NULL
  AND a.id <> b.id
  AND (a.updated_at, a.id) < (b.updated_at, b.id);

CREATE UNIQUE INDEX idx_listings_team_source_url_unique
  ON listings(team_id, source_url)
  WHERE source_url IS NOT NULL;
