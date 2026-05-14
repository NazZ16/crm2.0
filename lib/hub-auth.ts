// lib/hub-auth.ts
// Helper de auth para endpoints /api/query/*. O Hub envia uma shared secret
// no header `x-hub-secret`. CRM_QUERY_SECRET valida.

export function isHubAuthorized(request: Request): boolean {
  const secret = process.env.CRM_QUERY_SECRET
  if (!secret) {
    // Em dev sem secret configurado, deixa passar para nao bloquear testes locais.
    // Em prod, configura CRM_QUERY_SECRET para activar.
    return process.env.NODE_ENV !== 'production'
  }
  const header = request.headers.get('x-hub-secret')
  return header === secret
}

/**
 * Resolve o team_id para queries vindas do Hub. Usa CRM_DEFAULT_TEAM_ID
 * (configurada como env no Vercel do CRM). Permite override via header
 * `x-team-id` (futuro multi-tenant).
 */
export function resolveTeamId(request: Request): string | null {
  const headerTeam = request.headers.get('x-team-id')
  if (headerTeam) return headerTeam
  return process.env.CRM_DEFAULT_TEAM_ID ?? null
}
