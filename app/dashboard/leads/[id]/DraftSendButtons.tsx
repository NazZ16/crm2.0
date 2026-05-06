'use client'

import { Mail, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { buildWaLink, buildMailtoLink } from '@/lib/contact-links'

interface Props {
  channel: 'whatsapp' | 'email'
  body: string
  subject?: string | null
  leadPhone: string | null
  leadEmail: string | null
}

/**
 * Botoes "Enviar via WhatsApp" / "Enviar via Email" para um draft da AI.
 * - Mostra o botao do channel sugerido pelo agente como botao primario.
 * - Mostra o outro como botao secundario (porque tu podes preferir o outro
 *   canal mesmo que o agente sugira whatsapp/email).
 * - So aparece o botao se o contacto correspondente estiver preenchido.
 */
export function DraftSendButtons({ channel, body, subject, leadPhone, leadEmail }: Props) {
  const waLink = buildWaLink(leadPhone, body)
  const mailtoLink = buildMailtoLink(leadEmail, subject ?? null, body)

  const primaryIsWa = channel === 'whatsapp'
  const buttons: React.ReactNode[] = []

  // Botao primario (channel sugerido)
  if (primaryIsWa && waLink) {
    buttons.push(
      <a key="wa-primary" href={waLink} target="_blank" rel="noopener noreferrer">
        <Button size="sm" className="h-7 gap-1.5 bg-green-600 hover:bg-green-700 text-white">
          <Send size={12} />
          WhatsApp
        </Button>
      </a>
    )
  } else if (!primaryIsWa && mailtoLink) {
    buttons.push(
      <a key="email-primary" href={mailtoLink}>
        <Button size="sm" className="h-7 gap-1.5 bg-blue-600 hover:bg-blue-700 text-white">
          <Mail size={12} />
          Email
        </Button>
      </a>
    )
  }

  // Botao secundario (outro canal)
  if (primaryIsWa && mailtoLink) {
    buttons.push(
      <a key="email-secondary" href={mailtoLink}>
        <Button size="sm" variant="outline" className="h-7 gap-1.5">
          <Mail size={12} />
          Email
        </Button>
      </a>
    )
  } else if (!primaryIsWa && waLink) {
    buttons.push(
      <a key="wa-secondary" href={waLink} target="_blank" rel="noopener noreferrer">
        <Button size="sm" variant="outline" className="h-7 gap-1.5">
          <Send size={12} />
          WhatsApp
        </Button>
      </a>
    )
  }

  if (buttons.length === 0) return null
  return <div className="flex items-center gap-1.5">{buttons}</div>
}
