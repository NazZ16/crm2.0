'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { Loader2, Phone, Bot, User, ChevronRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { TaskCalendarButton } from '@/components/TaskCalendarButton'
import type { TaskRow } from './page'

const PRIORITY_COLOR: Record<TaskRow['priority'], string> = {
  urgent: 'bg-red-100 text-red-700 border-red-200',
  high: 'bg-orange-100 text-orange-700 border-orange-200',
  medium: 'bg-blue-100 text-blue-700 border-blue-200',
  low: 'bg-gray-100 text-gray-600 border-gray-200',
}

const PRIORITY_LABEL: Record<TaskRow['priority'], string> = {
  urgent: 'Urgente',
  high: 'Alta',
  medium: 'Media',
  low: 'Baixa',
}

function formatDue(due: string | null): string {
  if (!due) return ''
  const d = new Date(due)
  const now = new Date()
  const diffMs = d.getTime() - now.getTime()
  const diffH = Math.round(diffMs / (1000 * 60 * 60))
  const diffD = Math.round(diffMs / (1000 * 60 * 60 * 24))
  if (diffMs < 0) {
    const absH = Math.abs(diffH)
    if (absH < 24) return `atrasada ${absH}h`
    return `atrasada ${Math.abs(diffD)}d`
  }
  if (diffH < 24) return `em ${diffH}h`
  if (diffD < 7) return `em ${diffD}d`
  return d.toLocaleDateString('pt-PT', { day: 'numeric', month: 'short' })
}

export function TasksClient({ tasks }: { tasks: TaskRow[] }) {
  const router = useRouter()
  const [pending, setPending] = useState<Set<string>>(new Set())

  async function toggle(id: string, currentStatus: 'open' | 'done') {
    const next = currentStatus === 'open' ? 'done' : 'open'
    setPending((prev) => new Set(prev).add(id))
    try {
      const res = await fetch(`/api/tasks/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? 'Erro ao atualizar tarefa')
        return
      }
      toast.success(next === 'done' ? 'Tarefa concluida' : 'Tarefa reaberta')
      router.refresh()
    } catch {
      toast.error('Erro de ligacao')
    } finally {
      setPending((prev) => {
        const n = new Set(prev)
        n.delete(id)
        return n
      })
    }
  }

  if (tasks.length === 0) return null

  return (
    <ul className="divide-y divide-gray-100">
      {tasks.map((t) => {
        const isPending = pending.has(t.id)
        const isDone = t.status === 'done'
        const dueLabel = formatDue(t.due_at)
        const isOverdue = t.due_at != null && new Date(t.due_at) < new Date() && !isDone

        return (
          <li key={t.id} className="py-3 first:pt-0 last:pb-0">
            <div className="flex items-start gap-3">
              {/* Checkbox */}
              <button
                type="button"
                onClick={() => toggle(t.id, t.status)}
                disabled={isPending}
                className={`mt-0.5 h-5 w-5 rounded border flex items-center justify-center transition-colors flex-shrink-0 ${
                  isDone
                    ? 'bg-green-500 border-green-500 text-white'
                    : 'bg-white border-gray-300 hover:border-blue-500'
                } ${isPending ? 'opacity-50' : ''}`}
                aria-label={isDone ? 'Marcar como aberta' : 'Marcar como concluida'}
              >
                {isPending ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : isDone ? (
                  <svg viewBox="0 0 20 20" className="h-3 w-3" fill="currentColor">
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                ) : null}
              </button>

              {/* Conteudo */}
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`text-sm font-medium ${
                          isDone ? 'text-gray-400 line-through' : 'text-gray-900'
                        }`}
                      >
                        {t.title}
                      </span>
                      <Badge variant="outline" className={`text-xs ${PRIORITY_COLOR[t.priority]}`}>
                        {PRIORITY_LABEL[t.priority]}
                      </Badge>
                      {t.created_by === 'agent' && !isDone && (
                        <Badge variant="outline" className="text-xs bg-purple-50 text-purple-700 border-purple-200">
                          <Bot size={10} className="mr-1" />
                          IA
                        </Badge>
                      )}
                      {dueLabel && (
                        <span
                          className={`text-xs ${
                            isOverdue ? 'text-red-600 font-medium' : 'text-gray-400'
                          }`}
                        >
                          {dueLabel}
                        </span>
                      )}
                    </div>

                    {t.description && !isDone && (
                      <p className="text-xs text-gray-500 mt-1 line-clamp-2 whitespace-pre-wrap">
                        {t.description}
                      </p>
                    )}

                    <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                      <Link
                        href={`/dashboard/leads/${t.lead_id}`}
                        className="text-xs text-blue-600 hover:text-blue-800 inline-flex items-center gap-1"
                      >
                        <User size={11} />
                        {t.lead_name}
                        <ChevronRight size={11} />
                      </Link>
                      {t.lead_phone && !isDone && (
                        <a
                          href={`tel:${t.lead_phone}`}
                          className="text-xs text-gray-500 hover:text-gray-700 inline-flex items-center gap-1"
                        >
                          <Phone size={11} />
                          {t.lead_phone}
                        </a>
                      )}
                      {!isDone && (
                        <TaskCalendarButton
                          taskId={t.id}
                          hasDueAt={Boolean(t.due_at)}
                          googleEventId={t.google_event_id ?? null}
                          compact
                        />
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
