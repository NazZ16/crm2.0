'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { PlayCircle, Loader2 } from 'lucide-react'

export function AgentsClient() {
  const router = useRouter()
  const [running, setRunning] = useState<string | null>(null)

  async function runAgent(type: 'followup' | 'coach') {
    setRunning(type)
    try {
      const endpoint = type === 'followup' ? '/api/agents/followup' : '/api/agents/coach?type=weekly'
      const res = await fetch(endpoint, {
        method: type === 'followup' ? 'POST' : 'GET',
      })
      const data = await res.json()

      if (!res.ok) {
        toast.error(data.error || 'Erro ao executar agente')
        return
      }

      if (type === 'followup') {
        const items = data.items?.length ?? 0
        const tasks = data.tasks_created ?? 0
        toast.success(
          `Plano gerado: ${items} leads, ${tasks} tarefa${tasks === 1 ? '' : 's'} criada${tasks === 1 ? '' : 's'}`
        )
      } else {
        toast.success(`Coach analisou: ${data.learnings_added ?? 0} novas aprendizagens`)
      }
      router.refresh()
    } catch {
      toast.error('Erro de conexao')
    } finally {
      setRunning(null)
    }
  }

  return (
    <div className="flex gap-2">
      <Button
        variant="outline"
        size="sm"
        className="gap-2"
        onClick={() => runAgent('followup')}
        disabled={running !== null}
      >
        {running === 'followup' ? <Loader2 size={14} className="animate-spin" /> : <PlayCircle size={14} />}
        Plano de Follow-up
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="gap-2"
        onClick={() => runAgent('coach')}
        disabled={running !== null}
      >
        {running === 'coach' ? <Loader2 size={14} className="animate-spin" /> : <PlayCircle size={14} />}
        Coach Semanal
      </Button>
    </div>
  )
}
