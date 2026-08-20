// lib/whatsapp-ingest.ts — logica partilhada entre as duas fontes de mensagens de WhatsApp
// (webhook da Cloud API da Meta e o worker Baileys nao-oficial): dedup de lead por telefone,
// registo em `interactions` e `notifications`. Cada fonte so precisa de extrair
// phone/text/profileName/occurredAt do seu proprio formato de payload e chamar isto.
import { createServiceClient } from '@/lib/supabase/server'

const PLACEHOLDER_NAME = 'Lead (WhatsApp)'

export interface IncomingWhatsAppMessage {
  teamId: string
  userId: string
  phone: string
  text: string
  profileName?: string
  occurredAt: string
  /** true quando a mensagem foi enviada por nós (não pelo lead) — regista-se na timeline
   *  para dar contexto às análises de IA, mas não gera notificação nem atualiza o nome/perfil. */
  fromMe?: boolean
}

export async function resolveLeadAndLogMessage(
  supabase: ReturnType<typeof createServiceClient>,
  { teamId, userId, phone, text, profileName, occurredAt, fromMe }: IncomingWhatsAppMessage
): Promise<{ leadId: string }> {
  const { data: existingLead } = await supabase
    .from('leads')
    .select('id, full_name')
    .eq('team_id', teamId)
    .eq('phone', phone)
    .maybeSingle()

  let leadId: string
  let leadName: string

  if (existingLead) {
    leadId = existingLead.id
    leadName = existingLead.full_name ?? PLACEHOLDER_NAME

    const isPlaceholder = !existingLead.full_name || existingLead.full_name === PLACEHOLDER_NAME
    const leadUpdate: Record<string, unknown> = { last_contact_at: occurredAt }
    if (profileName && isPlaceholder) {
      leadUpdate.full_name = profileName
      leadName = profileName
    }

    await supabase.from('leads').update(leadUpdate).eq('id', leadId)
  } else {
    leadName = profileName ?? PLACEHOLDER_NAME
    const { data: newLead, error } = await supabase
      .from('leads')
      .insert({
        team_id: teamId,
        assigned_to: userId,
        full_name: leadName,
        phone,
        status: 'new',
        source: 'whatsapp',
        last_contact_at: occurredAt,
      })
      .select('id')
      .single()

    if (error || !newLead) {
      throw new Error(`Falhou a criar lead: ${error?.message ?? 'sem linha devolvida'}`)
    }
    leadId = newLead.id
  }

  // Prefixo "Eu:" nas mensagens que nós enviámos — sem isto a timeline (e as análises de IA
  // que a leem, ex. "Analisar Histórico") não tem forma de distinguir quem disse o quê.
  const displayText = fromMe ? `Eu: ${text}` : text
  const preview = displayText.length > 80 ? `${displayText.slice(0, 80)}…` : displayText

  await supabase.from('interactions').insert({
    lead_id: leadId,
    team_id: teamId,
    type: 'whatsapp',
    raw_text: displayText,
    summary: preview,
    occurred_at: occurredAt,
    direction: fromMe ? 'outbound' : 'inbound',
  })

  // Notificação só faz sentido para mensagens recebidas — não avisar de mensagens que
  // nós próprios acabámos de enviar.
  if (!fromMe) {
    await supabase.from('notifications').insert({
      team_id: teamId,
      type: 'whatsapp_message',
      title: '💬 Nova mensagem WhatsApp',
      body: `${leadName}: ${preview}`,
      link: `/dashboard/leads/${leadId}`,
    })
  }

  return { leadId }
}
