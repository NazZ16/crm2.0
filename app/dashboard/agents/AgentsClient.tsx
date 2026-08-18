'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import { PlayCircle, Loader2 } from 'lucide-react'
import type { FollowupPlan } from '@/lib/types'

const PRIORITY_LABELS: Record<string, string> = {
  urgent: 'Urgente',
  high: 'Alta',
  medium: 'Média',
  low: 'Baixa',
}

const PRIORITY_VARIANTS: Record<string, 'destructive' | 'default' | 'secondary' | 'outline'> = {
  urgent: 'destructive',
  high: 'default',
  medium: 'secondary',
  low: 'outline',
}

export function AgentsClient() {
  const router = useRouter()
  const [running, setRunning] = useState<string | null>(null)
  const [plan, setPlan] = useState<(FollowupPlan & { tasks_created: number }) | null>(null)

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
        setPlan(data)
      } else {
        if (data.insufficient_data) {
          toast.warning(data.message ?? 'Dados insuficientes para o Coach analisar.')
        } else {
          toast.success(`Coach analisou: ${data.learnings_added ?? 0} novas aprendizagens`)
        }
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

      <Dialog open={plan !== null} onOpenChange={(open) => !open && setPlan(null)}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Plano de Follow-up{plan ? ` — ${plan.date}` : ''}</DialogTitle>
            <DialogDescription>{plan?.summary}</DialogDescription>
          </DialogHeader>

          {plan && (
            <div className="space-y-3">
              {plan.tasks_created > 0 && (
                <p className="text-xs text-gray-500">
                  {plan.tasks_created} tarefa{plan.tasks_created === 1 ? '' : 's'} criada{plan.tasks_created === 1 ? '' : 's'} nas Tarefas
                  {plan.items.length > plan.tasks_created ? ' (algumas já existiam nas últimas 24h)' : ''}.
                </p>
              )}

              {plan.items.length === 0 ? (
                <p className="text-sm text-gray-400">Nenhuma lead a priorizar hoje.</p>
              ) : (
                <div className="space-y-2">
                  {plan.items.map((item, i) => (
                    <div key={`${item.lead_id}-${i}`} className="rounded-lg border border-gray-100 p-3 text-sm">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <Link href={`/dashboard/leads/${item.lead_id}`} className="font-medium text-gray-900 hover:text-blue-600">
                          {item.lead_name}
                        </Link>
                        <Badge variant={PRIORITY_VARIANTS[item.priority] ?? 'secondary'} className="text-[10px]">
                          {PRIORITY_LABELS[item.priority] ?? item.priority}
                        </Badge>
                      </div>
                      <p className="text-gray-600 text-xs mb-0.5">{item.reason}</p>
                      <p className="text-gray-900 text-xs font-medium">{item.action}</p>
                      {item.draft_message && (
                        <p className="text-blue-700 bg-blue-50 rounded p-2 mt-1.5 text-xs italic">&ldquo;{item.draft_message}&rdquo;</p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {plan.cold_leads.length > 0 && (
                <p className="text-xs text-amber-600">
                  {plan.cold_leads.length} lead{plan.cold_leads.length === 1 ? '' : 's'} fria{plan.cold_leads.length === 1 ? '' : 's'} (sem contacto há mais de 7 dias) não incluída{plan.cold_leads.length === 1 ? '' : 's'} acima.
                </p>
              )}
            </div>
          )}

          <DialogFooter showCloseButton />
        </DialogContent>
      </Dialog>
    </div>
  )
}
