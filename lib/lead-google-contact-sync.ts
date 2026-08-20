// lib/lead-google-contact-sync.ts
// Orquestra o sync de uma lead do CRM para um contacto no Google Contacts,
// chamado a partir das rotas de leads (create/update/delete). Sync
// unidirecional: o CRM e sempre a fonte de verdade, o Google Contacts nunca
// escreve de volta.

import { createServiceClient } from '@/lib/supabase/server'
import {
  createContact,
  updateContact,
  deleteContact,
  findContactByPhone,
  lookupContactByPhone,
  findOrCreateCrmContactGroup,
  type ContactPhoneIndex,
} from '@/lib/google-contacts'
import { LEAD_STATUS_LABELS, LEAD_TYPE_LABELS } from '@/lib/types'
import type { Lead } from '@/lib/types'

type SyncableLead = Pick<
  Lead,
  'id' | 'full_name' | 'phone' | 'email' | 'status' | 'lead_type' | 'tags' | 'notes'
> & { google_contact_resource_name?: string | null }

function buildBiography(lead: SyncableLead): string {
  const lines = [`CRM: ${LEAD_STATUS_LABELS[lead.status]} · ${LEAD_TYPE_LABELS[lead.lead_type]}`]
  if (lead.tags?.length) lines.push(`Tags: ${lead.tags.join(', ')}`)
  if (lead.notes) lines.push(`Notas: ${lead.notes.slice(0, 500)}`)
  lines.push('(sincronizado automaticamente do CRM)')
  return lines.join('\n')
}

/**
 * Cria/atualiza/apaga o contacto Google correspondente a uma lead, consoante
 * exista telefone. Best-effort: erros reais da API propagam para o caller
 * apanhar em try/catch — nunca deve bloquear o pedido principal do CRM.
 */
export async function syncLeadToGoogleContact(
  teamId: string,
  lead: SyncableLead,
  phoneIndex?: ContactPhoneIndex | null
): Promise<void> {
  const svc = createServiceClient()

  if (!lead.phone) {
    if (lead.google_contact_resource_name) {
      await deleteContact(teamId, lead.google_contact_resource_name)
      await svc
        .from('leads')
        .update({ google_contact_resource_name: null, google_contact_synced_at: null })
        .eq('id', lead.id)
    }
    return
  }

  const groupResourceName = await findOrCreateCrmContactGroup(teamId).catch(() => undefined)
  const input = {
    fullName: lead.full_name,
    phone: lead.phone,
    email: lead.email,
    biography: buildBiography(lead),
  }

  // Se ainda nao sabemos o contacto desta lead, procura por telefone antes
  // de criar — evita duplicar um contacto que ja existia manualmente. Se foi
  // passado um indice pre-construido (sync em lote), usa-o em vez de listar
  // os contactos outra vez — evitar isso é o que impede esgotar a quota da
  // People API quando ha muitas leads a sincronizar de uma vez.
  const existingResourceName =
    lead.google_contact_resource_name ??
    (phoneIndex
      ? lookupContactByPhone(phoneIndex, lead.phone)
      : await findContactByPhone(teamId, lead.phone).catch(() => null))

  const resourceName = existingResourceName
    ? await updateContact(teamId, existingResourceName, input)
    : await createContact(teamId, input, groupResourceName ?? undefined)

  if (!resourceName) return // sem conexao Google ativa — nada a persistir

  await svc
    .from('leads')
    .update({ google_contact_resource_name: resourceName, google_contact_synced_at: new Date().toISOString() })
    .eq('id', lead.id)
}

export async function deleteLeadGoogleContact(teamId: string, resourceName: string): Promise<void> {
  await deleteContact(teamId, resourceName)
}
