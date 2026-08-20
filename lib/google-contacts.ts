// lib/google-contacts.ts
// Cliente minimalista para a Google People API. Usa fetch puro, no mesmo
// estilo de lib/google-calendar.ts (mais leve, mais facil de debugar em
// serverless). Reutiliza a mesma ligacao OAuth ja usada para o Calendar
// (getValidAccessToken em google-calendar.ts) — so precisa do scope extra
// 'contacts', pedido em GOOGLE_OAUTH_SCOPES.
//
// Endpoint API:
//   - https://people.googleapis.com/v1/people:createContact
//   - https://people.googleapis.com/v1/people/{resourceName}:updateContact
//   - https://people.googleapis.com/v1/people/{resourceName}:deleteContact
//   - https://people.googleapis.com/v1/contactGroups

import { createServiceClient } from '@/lib/supabase/server'
import { getValidAccessToken } from '@/lib/google-calendar'

const PEOPLE_API_BASE = 'https://people.googleapis.com/v1'
const PERSON_FIELDS = 'names,phoneNumbers,emailAddresses,biographies,memberships'

export const CRM_CONTACT_GROUP_NAME = 'CRM Leads'

export interface GoogleContactInput {
  fullName: string
  phone: string | null // digitos PT sem indicativo (formato de lib/phone.ts)
  email: string | null
  biography: string
}

function phoneToE164PT(phone: string): string {
  return `+351${phone}`
}

// Compara so os ultimos 9 digitos (numero PT sem indicativo), para casar
// contactos guardados com/sem "+351", espacos ou tracos.
function phoneMatchKey(phone: string): string {
  return phone.replace(/\D/g, '').slice(-9)
}

function personBody(input: GoogleContactInput, groupResourceName?: string) {
  return {
    names: [{ givenName: input.fullName }],
    ...(input.phone ? { phoneNumbers: [{ value: phoneToE164PT(input.phone), type: 'mobile' }] } : {}),
    ...(input.email ? { emailAddresses: [{ value: input.email }] } : {}),
    biographies: [{ value: input.biography, contentType: 'TEXT_PLAIN' }],
    ...(groupResourceName
      ? { memberships: [{ contactGroupMembership: { contactGroupResourceName: groupResourceName } }] }
      : {}),
  }
}

/**
 * Cria um contacto novo. Devolve o resourceName (people/cXXXX) ou null se
 * nao ha ligacao Google ativa para o team.
 */
export async function createContact(
  teamId: string,
  input: GoogleContactInput,
  groupResourceName?: string
): Promise<string | null> {
  const tok = await getValidAccessToken(teamId)
  if (!tok) return null

  const res = await fetch(`${PEOPLE_API_BASE}/people:createContact?personFields=${PERSON_FIELDS}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tok.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(personBody(input, groupResourceName)),
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Google createContact falhou (${res.status}): ${errText}`)
  }
  const json = (await res.json()) as { resourceName: string }
  return json.resourceName
}

/**
 * Atualiza um contacto existente. A People API exige o etag atual, por isso
 * fazemos sempre um GET previo. Se o contacto foi apagado manualmente
 * (404/410), recria-o em vez de falhar.
 */
export async function updateContact(
  teamId: string,
  resourceName: string,
  input: GoogleContactInput
): Promise<string | null> {
  const tok = await getValidAccessToken(teamId)
  if (!tok) return null

  const getRes = await fetch(`${PEOPLE_API_BASE}/${resourceName}?personFields=metadata`, {
    headers: { Authorization: `Bearer ${tok.accessToken}` },
  })
  if (getRes.status === 404 || getRes.status === 410) {
    return createContact(teamId, input)
  }
  if (!getRes.ok) {
    const errText = await getRes.text()
    throw new Error(`Google getContact falhou (${getRes.status}): ${errText}`)
  }
  const current = (await getRes.json()) as { etag: string }

  const res = await fetch(
    `${PEOPLE_API_BASE}/${resourceName}:updateContact?updatePersonFields=${PERSON_FIELDS}&personFields=${PERSON_FIELDS}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${tok.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ etag: current.etag, ...personBody(input) }),
    }
  )

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Google updateContact falhou (${res.status}): ${errText}`)
  }
  const json = (await res.json()) as { resourceName: string }
  return json.resourceName
}

/**
 * Apaga um contacto. Tolerante a 404/410 (ja foi apagado manualmente).
 */
export async function deleteContact(teamId: string, resourceName: string): Promise<void> {
  const tok = await getValidAccessToken(teamId)
  if (!tok) return

  const res = await fetch(`${PEOPLE_API_BASE}/${resourceName}:deleteContact`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${tok.accessToken}` },
  })
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    const errText = await res.text()
    throw new Error(`Google deleteContact falhou (${res.status}): ${errText}`)
  }
}

/**
 * Procura, em TODOS os contactos Google do utilizador (nao so os criados
 * pelo CRM), um que ja tenha este numero de telefone — para evitar criar um
 * contacto duplicado quando a lead ja estava guardada manualmente. Devolve
 * o resourceName do primeiro match, ou null se nao ha ligacao ativa ou nao
 * encontrou nada.
 */
export async function findContactByPhone(teamId: string, phone: string): Promise<string | null> {
  const tok = await getValidAccessToken(teamId)
  if (!tok) return null

  const targetKey = phoneMatchKey(phoneToE164PT(phone))
  let pageToken: string | undefined
  let pagesFetched = 0

  do {
    const params = new URLSearchParams({
      personFields: 'phoneNumbers',
      pageSize: '1000',
      ...(pageToken ? { pageToken } : {}),
    })
    const res = await fetch(`${PEOPLE_API_BASE}/people/me/connections?${params.toString()}`, {
      headers: { Authorization: `Bearer ${tok.accessToken}` },
    })
    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`Google connections.list falhou (${res.status}): ${errText}`)
    }
    const json = (await res.json()) as {
      connections?: { resourceName: string; phoneNumbers?: { value?: string }[] }[]
      nextPageToken?: string
    }

    for (const person of json.connections ?? []) {
      const match = person.phoneNumbers?.some((p) => p.value && phoneMatchKey(p.value) === targetKey)
      if (match) return person.resourceName
    }

    pageToken = json.nextPageToken
    pagesFetched++
  } while (pageToken && pagesFetched < 20) // limite de seguranca (~20k contactos)

  return null
}

/**
 * Garante que existe um contactGroup "CRM Leads" no Google Contacts do
 * utilizador, para os contactos sincronizados ficarem separados dos
 * pessoais. O resourceName fica em cache em team_calendar_connections para
 * nao repetir o contactGroups.list a cada sync.
 */
export async function findOrCreateCrmContactGroup(teamId: string): Promise<string | null> {
  const svc = createServiceClient()
  const { data: conn } = await svc
    .from('team_calendar_connections')
    .select('google_contacts_group_resource_name')
    .eq('team_id', teamId)
    .eq('provider', 'google')
    .maybeSingle()
  if (conn?.google_contacts_group_resource_name) {
    return conn.google_contacts_group_resource_name as string
  }

  const tok = await getValidAccessToken(teamId)
  if (!tok) return null

  const listRes = await fetch(`${PEOPLE_API_BASE}/contactGroups?pageSize=100`, {
    headers: { Authorization: `Bearer ${tok.accessToken}` },
  })
  if (listRes.ok) {
    const listJson = (await listRes.json()) as { contactGroups?: { resourceName: string; name: string }[] }
    const existing = listJson.contactGroups?.find((g) => g.name === CRM_CONTACT_GROUP_NAME)
    if (existing) {
      await svc
        .from('team_calendar_connections')
        .update({ google_contacts_group_resource_name: existing.resourceName })
        .eq('team_id', teamId)
        .eq('provider', 'google')
      return existing.resourceName
    }
  }

  const createRes = await fetch(`${PEOPLE_API_BASE}/contactGroups`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tok.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ contactGroup: { name: CRM_CONTACT_GROUP_NAME } }),
  })
  if (!createRes.ok) return null
  const created = (await createRes.json()) as { resourceName: string }
  await svc
    .from('team_calendar_connections')
    .update({ google_contacts_group_resource_name: created.resourceName })
    .eq('team_id', teamId)
    .eq('provider', 'google')
  return created.resourceName
}
