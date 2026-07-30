'use client'

import { useState, useTransition, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  CONTENT_STATUS_LABELS,
  CONTENT_STATUS_COLORS,
  CONTENT_PLATFORM_LABELS,
  type ContentPiece,
  type ContentStatus,
} from '@/lib/types'
import { formatRelativeTime } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { MoveHorizontal, ExternalLink, Loader2 } from 'lucide-react'

interface Props {
  grouped: Record<ContentStatus, ContentPiece[]>
  order: ContentStatus[]
  canEdit: boolean
}

const STATUS_BORDER: Record<ContentStatus, string> = {
  idea: 'border-t-gray-400',
  draft: 'border-t-blue-400',
  scheduled: 'border-t-yellow-400',
  published: 'border-t-green-500',
  archived: 'border-t-gray-300',
}

function toDatetimeLocal(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function ContentBoard({ grouped, order, canEdit }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [boardState, setBoardState] = useState(grouped)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [moveTarget, setMoveTarget] = useState<{ id: string; title: string; status: ContentStatus } | null>(null)
  const [editTarget, setEditTarget] = useState<ContentPiece | null>(null)
  const [draftContent, setDraftContent] = useState('')
  const [scheduledAt, setScheduledAt] = useState('')
  const [publishedUrl, setPublishedUrl] = useState('')
  const inflightRef = useRef(0)

  useEffect(() => {
    if (inflightRef.current > 0) return
    setBoardState(grouped)
  }, [grouped])

  async function patchPiece(id: string, body: Record<string, unknown>): Promise<ContentPiece | null> {
    const res = await fetch(`/api/content/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const j = await res.json().catch(() => null)
      throw new Error(j?.error || 'Falha a guardar')
    }
    return res.json()
  }

  async function movePiece(id: string, fromStatus: ContentStatus, toStatus: ContentStatus) {
    if (fromStatus === toStatus) return
    if (!canEdit) {
      toast.error('Sem permissoes para alterar conteudo.')
      return
    }

    const piece = boardState[fromStatus].find((p) => p.id === id)
    if (!piece) return

    const optimisticPiece: ContentPiece = { ...piece, status: toStatus }
    const optimistic: Record<ContentStatus, ContentPiece[]> = {
      ...boardState,
      [fromStatus]: boardState[fromStatus].filter((p) => p.id !== id),
      [toStatus]: [optimisticPiece, ...boardState[toStatus]],
    }
    setBoardState(optimistic)
    setSavingId(id)
    inflightRef.current += 1

    try {
      await patchPiece(id, { status: toStatus })
      toast.success(`${piece.title} → ${CONTENT_STATUS_LABELS[toStatus]}`)
      startTransition(() => router.refresh())
    } catch (err) {
      const rollback: Record<ContentStatus, ContentPiece[]> = {
        ...boardState,
        [fromStatus]: [piece, ...boardState[fromStatus].filter((p) => p.id !== id)],
        [toStatus]: boardState[toStatus].filter((p) => p.id !== id),
      }
      setBoardState(rollback)
      const msg = err instanceof Error ? err.message : 'Erro desconhecido'
      toast.error(`Não foi possível mover: ${msg}`)
    } finally {
      setSavingId(null)
      inflightRef.current = Math.max(0, inflightRef.current - 1)
    }
  }

  function openEdit(piece: ContentPiece) {
    setEditTarget(piece)
    setDraftContent(piece.draft_content ?? '')
    setScheduledAt(toDatetimeLocal(piece.scheduled_at))
    setPublishedUrl(piece.published_url ?? '')
  }

  async function saveEdit() {
    if (!editTarget) return
    setSavingId(editTarget.id)
    try {
      const updated = await patchPiece(editTarget.id, {
        draft_content: draftContent || null,
        scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : null,
        published_url: publishedUrl || null,
      })
      if (updated) {
        setBoardState((prev) => ({
          ...prev,
          [updated.status]: prev[updated.status].map((p) => (p.id === updated.id ? updated : p)),
        }))
      }
      toast.success('Guardado')
      setEditTarget(null)
      startTransition(() => router.refresh())
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro desconhecido'
      toast.error(`Não foi possível guardar: ${msg}`)
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className="overflow-x-auto pb-4">
      <div className="flex gap-3 min-w-max">
        {order.map((status) => {
          const pieces = boardState[status]
          return (
            <div
              key={status}
              className={`w-72 flex-shrink-0 bg-gray-50 rounded-lg border-t-4 ${STATUS_BORDER[status]}`}
            >
              <div className="px-3 pt-3 pb-2 sticky top-0 bg-inherit rounded-t-lg">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm text-gray-800 truncate">
                    {CONTENT_STATUS_LABELS[status]}
                  </span>
                  <Badge variant="outline" className="text-xs flex-shrink-0">
                    {pieces.length}
                  </Badge>
                </div>
              </div>

              <div className="px-2 pb-2 space-y-2 min-h-[120px]">
                {pieces.length === 0 && (
                  <div className="text-center py-8 border-2 border-dashed border-gray-200 rounded-lg mx-1">
                    <p className="text-xs text-gray-400">Sem itens</p>
                  </div>
                )}

                {pieces.map((piece) => {
                  const isSaving = savingId === piece.id
                  return (
                    <div
                      key={piece.id}
                      onClick={() => openEdit(piece)}
                      className={`bg-white border border-gray-200 rounded-lg p-3 cursor-pointer transition-all hover:shadow-md ${
                        isSaving ? 'opacity-60 pointer-events-none' : ''
                      }`}
                    >
                      <div className="flex items-start gap-2 mb-1.5">
                        <p className="font-medium text-sm text-gray-900 flex-1 min-w-0 line-clamp-2">
                          {piece.title}
                        </p>
                        {canEdit && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setMoveTarget({ id: piece.id, title: piece.title, status })
                            }}
                            aria-label="Mover conteudo"
                            title="Mover para outro estado"
                            className="flex-shrink-0 -my-1 -mr-1 p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-700 active:scale-95 transition"
                          >
                            <MoveHorizontal size={14} />
                          </button>
                        )}
                      </div>

                      <div className="flex items-center justify-between text-xs text-gray-500 gap-2">
                        <Badge variant="outline" className="text-[10px]">
                          {CONTENT_PLATFORM_LABELS[piece.platform]}
                        </Badge>
                        {piece.scheduled_at ? (
                          <span className="text-[10px] text-gray-500">
                            {new Date(piece.scheduled_at).toLocaleDateString('pt-PT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                          </span>
                        ) : (
                          <span className="text-[10px] text-gray-400">{formatRelativeTime(piece.created_at)}</span>
                        )}
                      </div>

                      {piece.published_url && (
                        <a
                          href={piece.published_url}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="flex items-center gap-1 text-[10px] text-blue-600 hover:underline mt-1.5"
                        >
                          <ExternalLink size={10} /> Ver publicação
                        </a>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {!canEdit && (
        <p className="text-xs text-gray-400 mt-3 text-center">
          Tens permissão apenas de leitura.
        </p>
      )}

      {/* Dialog mobile-friendly: tap "Mover" abre lista de estados para escolher */}
      <Dialog open={moveTarget !== null} onOpenChange={(v) => (!v ? setMoveTarget(null) : null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Mover conteúdo</DialogTitle>
            <DialogDescription>
              {moveTarget && (
                <>
                  <strong>{moveTarget.title}</strong> está em{' '}
                  <strong>{CONTENT_STATUS_LABELS[moveTarget.status]}</strong>. Escolhe novo estado:
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-2 py-2">
            {(['idea', 'draft', 'scheduled', 'published', 'archived'] as ContentStatus[])
              .filter((s) => s !== moveTarget?.status)
              .map((s) => (
                <button
                  key={s}
                  onClick={async () => {
                    if (!moveTarget) return
                    const target = moveTarget
                    setMoveTarget(null)
                    await movePiece(target.id, target.status, s)
                  }}
                  className={`flex items-center justify-between p-3 rounded-lg border-2 transition active:scale-[0.98] hover:shadow-sm ${STATUS_BORDER[s].replace('border-t-', 'border-')} bg-white text-left`}
                >
                  <Badge className={`text-xs ${CONTENT_STATUS_COLORS[s]}`}>
                    {CONTENT_STATUS_LABELS[s]}
                  </Badge>
                  <span className="text-xs text-gray-400">→</span>
                </button>
              ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog de edicao: rascunho, data de agendamento, link publicado */}
      <Dialog open={editTarget !== null} onOpenChange={(v) => (!v ? setEditTarget(null) : null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editTarget?.title}</DialogTitle>
            <DialogDescription>
              {editTarget && CONTENT_PLATFORM_LABELS[editTarget.platform]} — {editTarget && CONTENT_STATUS_LABELS[editTarget.status]}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {editTarget?.idea_text && (
              <div>
                <Label className="text-xs text-gray-500">Ideia original</Label>
                <p className="text-sm text-gray-600 mt-1">{editTarget.idea_text}</p>
              </div>
            )}
            <div>
              <Label htmlFor="draft-content">Rascunho</Label>
              <Textarea
                id="draft-content"
                value={draftContent}
                onChange={(e) => setDraftContent(e.target.value)}
                rows={6}
                disabled={!canEdit}
                placeholder="Escreve o texto final aqui..."
              />
            </div>
            <div>
              <Label htmlFor="scheduled-at">Data de publicação (agendado)</Label>
              <Input
                id="scheduled-at"
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                disabled={!canEdit}
              />
            </div>
            <div>
              <Label htmlFor="published-url">Link publicado</Label>
              <Input
                id="published-url"
                type="url"
                value={publishedUrl}
                onChange={(e) => setPublishedUrl(e.target.value)}
                disabled={!canEdit}
                placeholder="https://..."
              />
            </div>
          </div>
          {canEdit && (
            <DialogFooter>
              <Button onClick={saveEdit} disabled={savingId === editTarget?.id}>
                {savingId === editTarget?.id && <Loader2 size={14} className="mr-1.5 animate-spin" />}
                Guardar
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
