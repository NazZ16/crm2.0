'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { CONTENT_PLATFORM_LABELS, type ContentPlatform } from '@/lib/types'

const PLATFORMS = Object.entries(CONTENT_PLATFORM_LABELS) as [ContentPlatform, string][]

export default function NewContentButton() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [title, setTitle] = useState('')
  const [platform, setPlatform] = useState<ContentPlatform | ''>('')
  const [ideaText, setIdeaText] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          platform: platform || undefined,
          idea_text: ideaText.trim() || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Erro ao criar ideia')
      } else {
        setOpen(false)
        resetForm()
        router.refresh()
      }
    } catch {
      setError('Falha na comunicação com o servidor')
    } finally {
      setLoading(false)
    }
  }

  function resetForm() {
    setTitle('')
    setPlatform('')
    setIdeaText('')
    setError(null)
  }

  function handleOpenChange(isOpen: boolean) {
    setOpen(isOpen)
    if (!isOpen) resetForm()
  }

  return (
    <>
      <Button onClick={() => setOpen(true)} variant="outline" className="gap-2">
        <Plus size={16} />
        Nova ideia
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nova ideia de conteúdo</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label htmlFor="title">Título *</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="ex: Reel sobre angariações"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label>Plataforma</Label>
              <Select value={platform} onValueChange={(v) => setPlatform(v as ContentPlatform)}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecionar plataforma" />
                </SelectTrigger>
                <SelectContent>
                  {PLATFORMS.map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="idea-text">Notas (opcional)</Label>
              <Textarea
                id="idea-text"
                value={ideaText}
                onChange={(e) => setIdeaText(e.target.value)}
                rows={3}
                placeholder="Detalhes da ideia..."
              />
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <DialogFooter>
              <Button type="submit" disabled={loading || !title.trim()}>
                {loading && <Loader2 size={14} className="mr-1.5 animate-spin" />}
                Criar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
