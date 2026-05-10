// lib/google-calendar.ts
// Cliente minimalista para Google Calendar API. Usa fetch puro sem dependencia
// do googleapis package (mais leve, mais facil de debugar em serverless).
//
// Endpoints OAuth:
//   - https://accounts.google.com/o/oauth2/v2/auth   (consent)
//   - https://oauth2.googleapis.com/token            (token exchange + refresh)
//
// Endpoint API:
//   - https://www.googleapis.com/calendar/v3/calendars/{calendarId}/events

import { createServiceClient } from '@/lib/supabase/server'

// Scope completo: read + write events. O user precisa re-autorizar uma vez para mudar de readonly.
export const GOOGLE_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ')

// Marker em extendedProperties.private para identificar eventos criados pelo CRM
// e poder filtra-los no card "Agenda de hoje" (evitar duplicacao com tasks).
export const CRM_EVENT_MARKER_KEY = 'source'
export const CRM_EVENT_MARKER_VALUE = 'crm-task'

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo'

export interface GoogleTokenResponse {
  access_token: string
  expires_in: number
  refresh_token?: string
  scope: string
  token_type: string
  id_token?: string
}

export interface GoogleCalendarEvent {
  id: string
  summary: string | null
  description: string | null
  location: string | null
  start: { dateTime?: string; date?: string; timeZone?: string }
  end: { dateTime?: string; date?: string; timeZone?: string }
  status: string
  htmlLink: string
  attendees?: { email: string; responseStatus?: string; displayName?: string }[]
  hangoutLink?: string
  conferenceData?: { entryPoints?: { uri: string; entryPointType: string }[] }
  extendedProperties?: { private?: Record<string, string>; shared?: Record<string, string> }
}

/**
 * True se o evento foi criado pelo CRM (a partir de uma task).
 * Usado para filtra-los do card "Agenda de hoje" — caso contrario veriamos
 * a mesma coisa duas vezes (uma como task, outra como evento Google).
 */
export function isCrmCreatedEvent(ev: GoogleCalendarEvent): boolean {
  return ev.extendedProperties?.private?.[CRM_EVENT_MARKER_KEY] === CRM_EVENT_MARKER_VALUE
}

export function getOAuthRedirectUri(origin: string): string {
  return `${origin}/api/auth/google/callback`
}

export function buildAuthUrl(origin: string, state: string): string {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID
  if (!clientId) throw new Error('GOOGLE_OAUTH_CLIENT_ID nao configurado')

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getOAuthRedirectUri(origin),
    response_type: 'code',
    scope: GOOGLE_OAUTH_SCOPES,
    access_type: 'offline',     // emite refresh_token
    prompt: 'consent',          // forca refresh_token mesmo se ja deu permissao antes
    state,
  })
  return `${GOOGLE_AUTH_URL}?${params.toString()}`
}

export async function exchangeCodeForTokens(code: string, origin: string): Promise<GoogleTokenResponse> {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET
  if (!clientId || !clientSecret) throw new Error('Google OAuth credentials nao configuradas')

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: getOAuthRedirectUri(origin),
      grant_type: 'authorization_code',
    }),
  })
  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Google token exchange falhou (${res.status}): ${errText}`)
  }
  return res.json() as Promise<GoogleTokenResponse>
}

export async function refreshAccessToken(refreshToken: string): Promise<GoogleTokenResponse> {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET
  if (!clientId || !clientSecret) throw new Error('Google OAuth credentials nao configuradas')

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Google token refresh falhou (${res.status}): ${errText}`)
  }
  return res.json() as Promise<GoogleTokenResponse>
}

export async function fetchGoogleEmail(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) return null
    const json = await res.json() as { email?: string }
    return json.email ?? null
  } catch {
    return null
  }
}

/**
 * Devolve um access_token valido para o team. Usa cache em DB.
 * Se o cached access_token expirou, faz refresh automaticamente e persiste.
 */
export async function getValidAccessToken(teamId: string): Promise<{ accessToken: string; calendarId: string } | null> {
  const svc = createServiceClient()
  const { data: conn } = await svc
    .from('team_calendar_connections')
    .select('refresh_token, access_token, expires_at, calendar_id')
    .eq('team_id', teamId)
    .eq('provider', 'google')
    .maybeSingle()

  if (!conn) return null

  const now = Date.now()
  const expiresAt = conn.expires_at ? new Date(conn.expires_at).getTime() : 0
  // Se temos access_token valido com pelo menos 60s de margem, usa-o.
  if (conn.access_token && expiresAt > now + 60_000) {
    return { accessToken: conn.access_token, calendarId: conn.calendar_id ?? 'primary' }
  }

  // Refresh
  const refreshed = await refreshAccessToken(conn.refresh_token)
  const newExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString()

  await svc
    .from('team_calendar_connections')
    .update({
      access_token: refreshed.access_token,
      expires_at: newExpiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq('team_id', teamId)
    .eq('provider', 'google')

  return { accessToken: refreshed.access_token, calendarId: conn.calendar_id ?? 'primary' }
}

/**
 * Eventos entre `timeMin` (ISO) e `timeMax` (ISO).
 * Devolve [] se nao ha conexao Google ativa.
 */
export async function listEvents(
  teamId: string,
  timeMin: string,
  timeMax: string,
  maxResults: number = 50
): Promise<GoogleCalendarEvent[]> {
  const tok = await getValidAccessToken(teamId)
  if (!tok) return []

  const params = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: 'true',           // expande recurring events
    orderBy: 'startTime',
    maxResults: String(maxResults),
  })

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(tok.calendarId)}/events?${params.toString()}`,
    { headers: { Authorization: `Bearer ${tok.accessToken}` } }
  )

  if (!res.ok) {
    const errText = await res.text()
    console.warn(`[google-calendar] listEvents falhou (${res.status}): ${errText}`)
    return []
  }

  const json = await res.json() as { items?: GoogleCalendarEvent[] }
  return json.items ?? []
}

/**
 * Cria um evento no Google Calendar com marker CRM.
 *
 * @param teamId  team da conexao Google
 * @param event   dados do evento (summary obrigatorio, start/end ISO datetime)
 * @param crmTaskId  id da task no CRM (vai para extendedProperties.private.crm_task_id)
 * @returns       evento criado (com id Google) ou null se nao ha conexao
 */
export async function createEvent(
  teamId: string,
  event: {
    summary: string
    description?: string
    location?: string
    start: { dateTime: string; timeZone?: string }
    end: { dateTime: string; timeZone?: string }
  },
  crmTaskId: string
): Promise<GoogleCalendarEvent | null> {
  const tok = await getValidAccessToken(teamId)
  if (!tok) return null

  const body = {
    ...event,
    extendedProperties: {
      private: {
        [CRM_EVENT_MARKER_KEY]: CRM_EVENT_MARKER_VALUE,
        crm_task_id: crmTaskId,
      },
    },
  }

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(tok.calendarId)}/events`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tok.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  )

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Google createEvent falhou (${res.status}): ${errText}`)
  }
  return res.json() as Promise<GoogleCalendarEvent>
}

/**
 * Apaga um evento no Google Calendar.
 * Tolerante a 404 (ja foi apagado manualmente).
 */
export async function deleteEvent(teamId: string, eventId: string): Promise<void> {
  const tok = await getValidAccessToken(teamId)
  if (!tok) return

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(tok.calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tok.accessToken}` },
    }
  )
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    const errText = await res.text()
    throw new Error(`Google deleteEvent falhou (${res.status}): ${errText}`)
  }
}

export async function listTodaysEvents(teamId: string, timezone: string = 'Europe/Lisbon'): Promise<GoogleCalendarEvent[]> {
  // Inicio do dia local em UTC
  const now = new Date()
  // Calcula start/end do dia no timezone Lisbon. Para simplicidade usa UTC offset.
  // (Lisbon e UTC+0 no inverno, UTC+1 no verao — para precisao usariamos Intl, mas
  // basta-nos uma janela alargada que apanhe toda a agenda do dia.)
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0)
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59)
  void timezone
  return listEvents(teamId, start.toISOString(), end.toISOString(), 100)
}
