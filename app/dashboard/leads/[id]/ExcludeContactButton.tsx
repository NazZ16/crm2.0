'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { BellOff, Bell, Loader2 } from 'lucide-react'

interface Props {
  leadId: string
  leadPhone: string | null
  initialExcluded: boolean
}

export function ExcludeContactButton({ leadId, leadPhone, initialExcluded }: Props) {
  const router = useRouter()
  const [excluded, setExcluded] = useState(initialExcluded)
  const [loading, setLoading] = useState(false)

  if (!leadPhone) return null

  async function handleToggle() {
    setLoading(true)
    try {
      const res = await fetch(`/api/leads/${leadId}/exclude`, {
        method: excluded ? 'DELETE' : 'POST',
      })
      if (res.ok) {
        setExcluded(!excluded)
        toast.success(
          excluded
            ? 'Contacto reativado — volta a gerar leads e análises'
            : 'Contacto excluído — não vai gerar leads nem ser analisado'
        )
        router.refresh()
      } else {
        const data = await res.json()
        toast.error(data.error ?? 'Erro ao atualizar exclusão')
      }
    } catch {
      toast.error('Erro de ligação')
    } finally {
      setLoading(false)
    }
  }

  if (excluded) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="gap-2 text-amber-700 border-amber-300 bg-amber-50 hover:bg-amber-100"
        onClick={handleToggle}
        disabled={loading}
        title="Este número está excluído — não gera leads nem é analisado"
      >
        {loading ? <Loader2 size={14} className="animate-spin" /> : <BellOff size={14} />}
        Excluído da IA
      </Button>
    )
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      className="gap-2 text-gray-400 hover:text-amber-700 hover:bg-amber-50"
      onClick={handleToggle}
      disabled={loading}
      title="Contacto pessoal ou colega — não analisar nem gerar leads a partir deste número"
    >
      {loading ? <Loader2 size={14} className="animate-spin" /> : <Bell size={14} />}
      Não analisar
    </Button>
  )
}
