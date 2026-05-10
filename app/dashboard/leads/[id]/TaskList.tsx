'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { TASK_PRIORITY_COLORS, TASK_PRIORITY_LABELS } from '@/lib/types'
import { formatDateTime } from '@/lib/utils'
import type { TaskPriority } from '@/lib/types'
import { TaskCalendarButton } from '@/components/TaskCalendarButton'

interface TaskItem {
  id: string
  title: string
  description?: string | null
  priority: string
  due_at?: string | null
  created_by: string
  status: string
  google_event_id?: string | null
}

interface Props {
  initialOpenTasks: TaskItem[]
  initialDoneTasks: TaskItem[]
}

export function TaskList({ initialOpenTasks, initialDoneTasks }: Props) {
  const router = useRouter()
  const [openTasks, setOpenTasks] = useState(initialOpenTasks)
  const [doneTasks, setDoneTasks] = useState(initialDoneTasks)
  const [completing, setCompleting] = useState<string | null>(null)

  async function completeTask(taskId: string) {
    setCompleting(taskId)
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'done' }),
      })

      if (res.ok) {
        const task = openTasks.find((t) => t.id === taskId)!
        setOpenTasks((prev) => prev.filter((t) => t.id !== taskId))
        setDoneTasks((prev) => [{ ...task, status: 'done' }, ...prev])
        toast.success('Tarefa concluída!')
        router.refresh()
      } else {
        toast.error('Erro ao concluir tarefa')
      }
    } catch {
      toast.error('Erro de conexão')
    } finally {
      setCompleting(null)
    }
  }

  if (openTasks.length === 0 && doneTasks.length === 0) {
    return <p className="text-sm text-gray-400 text-center py-3">Sem tarefas</p>
  }

  return (
    <div className="space-y-2">
      {openTasks.map((task) => {
        const isOverdue = task.due_at && new Date(task.due_at) < new Date()
        const isCompleting = completing === task.id

        return (
          <div key={task.id} className="flex items-start gap-3 p-3 rounded-lg bg-gray-50">
            <button
              onClick={() => completeTask(task.id)}
              disabled={isCompleting}
              className="mt-0.5 flex-shrink-0 text-gray-300 hover:text-green-500 transition-colors disabled:opacity-50"
              title="Marcar como concluída"
            >
              {isCompleting ? (
                <Loader2 size={16} className="animate-spin text-gray-400" />
              ) : (
                <CheckCircle2 size={16} />
              )}
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-medium text-gray-800">{task.title}</p>
                <Badge className={`text-xs ${TASK_PRIORITY_COLORS[task.priority as TaskPriority]}`}>
                  {TASK_PRIORITY_LABELS[task.priority as TaskPriority]}
                </Badge>
                {task.created_by === 'agent' && (
                  <span className="text-xs text-purple-500">🤖</span>
                )}
              </div>
              {task.description && (
                <p className="text-xs text-gray-500 mt-0.5">{task.description}</p>
              )}
              {task.due_at && (
                <p className={`text-xs mt-1 ${isOverdue ? 'text-red-500 font-medium' : 'text-gray-400'}`}>
                  {isOverdue ? '⚠️ ' : ''}{formatDateTime(task.due_at)}
                </p>
              )}
              <div className="mt-1.5">
                <TaskCalendarButton
                  taskId={task.id}
                  hasDueAt={Boolean(task.due_at)}
                  googleEventId={task.google_event_id ?? null}
                />
              </div>
            </div>
          </div>
        )
      })}

      {doneTasks.length > 0 && (
        <div className="pt-1">
          <p className="text-xs text-gray-400 mb-2">Concluídas ({doneTasks.length})</p>
          {doneTasks.slice(0, 3).map((task) => (
            <div key={task.id} className="flex items-center gap-2 py-1">
              <CheckCircle2 size={14} className="text-green-500 flex-shrink-0" />
              <p className="text-sm text-gray-400 line-through">{task.title}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
