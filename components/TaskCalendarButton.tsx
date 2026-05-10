'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarDays, Check, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

interface Props {
  taskId: string
  hasDueAt: boolean
  googleEventId: string | null
  /** URL pre-existente do evento (htmlLink). Se null, geramos pela API ao clicar. */
  initialHtmlLink?: string | null
  /** Tamanho compacto (apenas icone) ou expandido (icone + label) */
  compact?: boolean
}

/**
 * Botao para sincronizar uma task com o Google Calendar.
 *
 * Estados:
 *  - Sem due_at: disabled com tooltip
 *  - Nao sincronizada: "Adicionar ao Calendar"
 *  - Sincronizada: "✓ No Calendar" — clicar abre o evento no Google
 */
export function TaskCalendarButton({
  taskId,
  hasDueAt,
  googleEventId,
  initialHtmlLink,
  compact = false,
}: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [synced, setSynced] = useState<boolean>(Boolean(googleEventId))
  const [link, setLink] = useState<string | null>(initialHtmlLink ?? null)

  if (!hasDueAt) {
    return (
      <button
        disabled
        title="Define um prazo (due_at) para poder sincronizar"
        className="text-xs text-gray-400 cursor-not-allowed inline-flex items-center gap-1"
      >
        <CalendarDays size={compact ? 12 : 14} />
        {!compact && <span>Sem prazo</span>}
      </button>
    )
  }

  if (synced) {
    return link ? (
      <a
        href={link}
        target="_blank"
        rel="noopener noreferrer"
        title="Abrir evento no Google Calendar"
        className="text-xs text-green-700 hover:text-green-900 inline-flex items-center gap-1 font-medium"
      >
        <Check size={compact ? 12 : 14} />
        {!compact && <span>No Calendar</span>}
      </a>
    ) : (
      <span className="text-xs text-green-700 inline-flex items-center gap-1 font-medium">
        <Check size={compact ? 12 : 14} />
        {!compact && <span>No Calendar</span>}
      </span>
    )
  }

  async function handleAdd(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    setLoading(true)
    try {
      const res = await fetch(`/api/tasks/${taskId}/calendar`, { method: 'POST' })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        if (data?.needsReauth) {
          toast.error('Re-liga o Google Calendar (precisamos de mais permissoes)', {
            action: { label: 'Settings', onClick: () => router.push('/dashboard/settings') },
          })
        } else {
          toast.error(data?.error ?? 'Erro a sincronizar')
        }
        return
      }
      setSynced(true)
      setLink(data.htmlLink ?? null)
      toast.success('Adicionado ao Google Calendar')
      router.refresh()
    } catch {
      toast.error('Erro de ligacao')
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      onClick={handleAdd}
      disabled={loading}
      title="Adicionar ao Google Calendar"
      className="text-xs text-blue-600 hover:text-blue-800 inline-flex items-center gap-1 font-medium disabled:opacity-50"
    >
      {loading ? <Loader2 size={compact ? 12 : 14} className="animate-spin" /> : <CalendarDays size={compact ? 12 : 14} />}
      {!compact && <span>Calendar</span>}
    </button>
  )
}
