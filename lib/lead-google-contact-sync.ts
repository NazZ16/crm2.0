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
  appendContactNote,
  removeContactNote,
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
> & { google_contact_resource_name?: string | null; google_contact_preexisting?: boolean | null }

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

  // Lead sem telefone (ou telefone apagado): desliga do contacto Google, se
  // havia algum associado. Um contacto pre-existente (nao criado pelo CRM)
  // nunca e apagado — so removemos o nosso bloco de info da biografia.
  if (!lead.phone) {
    if (lead.google_contact_resource_name) {
      if (lead.google_contact_preexisting) {
        await removeContactNote(teamId, lead.google_contact_resource_name)
      } else {
        await deleteContact(teamId, lead.google_contact_resource_name)
      }
      await svc
        .from('leads')
        .update({ google_contact_resource_name: null, google_contact_preexisting: false, google_contact_synced_at: null })
        .eq('id', lead.id)
    }
    return
  }

  const crmBlock = buildBiography(lead)

  // Contacto ja associado e marcado como pre-existente: so acrescenta a
  // info do CRM na biografia, nunca mexe em nome/telefone/email — esse
  // contacto ja existia manualmente antes do sync.
  if (lead.google_contact_resource_name && lead.google_contact_preexisting) {
    await appendContactNote(teamId, lead.google_contact_resource_name, crmBlock)
    await svc
      .from('leads')
      .update({ google_contact_synced_at: new Date().toISOString() })
      .eq('id', lead.id)
    return
  }

  const input = {
    fullName: lead.full_name,
    phone: lead.phone,
    email: lead.email,
    biography: crmBlock,
  }

  // Contacto ja associado e criado pelo proprio CRM: mantem tudo atualizado.
  if (lead.google_contact_resource_name) {
    const resourceName = await updateContact(teamId, lead.google_contact_resource_name, input)
    if (resourceName) {
      await svc
        .from('leads')
        .update({ google_contact_synced_at: new Date().toISOString() })
        .eq('id', lead.id)
    }
    return
  }

  // Ainda nao sincronizado: procura por telefone antes de criar, para nao
  // duplicar um contacto que ja existia manualmente. Se foi passado um
  // indice pre-construido (sync em lote), usa-o em vez de listar os
  // contactos outra vez — evitar isso é o que impede esgotar a quota da
  // People API quando ha muitas leads a sincronizar de uma vez.
  const matchedResourceName = phoneIndex
    ? lookupContactByPhone(phoneIndex, lead.phone)
    : await findContactByPhone(teamId, lead.phone).catch(() => null)

  if (matchedResourceName) {
    await appendContactNote(teamId, matchedResourceName, crmBlock)
    await svc
      .from('leads')
      .update({
        google_contact_resource_name: matchedResourceName,
        google_contact_preexisting: true,
        google_contact_synced_at: new Date().toISOString(),
      })
      .eq('id', lead.id)
    return
  }

  const groupResourceName = await findOrCreateCrmContactGroup(teamId).catch(() => undefined)
  const resourceName = await createContact(teamId, input, groupResourceName ?? undefined)
  if (!resourceName) return // sem conexao Google ativa — nada a persistir

  await svc
    .from('leads')
    .update({
      google_contact_resource_name: resourceName,
      google_contact_preexisting: false,
      google_contact_synced_at: new Date().toISOString(),
    })
    .eq('id', lead.id)
}

/**
 * Usado quando uma lead e eliminada do CRM. Um contacto pre-existente (nao
 * criado pelo CRM) nunca e apagado — so removemos o nosso bloco de info.
 */
export async function unlinkLeadGoogleContact(
  teamId: string,
  resourceName: string,
  preexisting: boolean
): Promise<void> {
  if (preexisting) {
    await removeContactNote(teamId, resourceName)
  } else {
    await deleteContact(teamId, resourceName)
  }
}
