'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'
import { Merge, Loader2, Search } from 'lucide-react'

interface Lead {
  id: string
  full_name: string
  phone: string | null
  email: string | null
}

interface Props {
  leadId: string
  leadName: string
  isAdmin: boolean
}

export function MergeLeadsButton({ leadId, leadName, isAdmin }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<Lead[]>([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<Lead | null>(null)
  const [merging, setMerging] = useState(false)
  const [confirm, setConfirm] = useState(false)

  if (!isAdmin) return null

  async function handleSearch() {
    if (!search.trim()) return
    setSearching(true)
    try {
      const res = await fetch(`/api/leads?q=${encodeURIComponent(search)}&limit=10`)
      const data = await res.json()
      // A API retorna um array directamente; filtrar a lead actual
      setResults((Array.isArray(data) ? data : []).filter((l: Lead) => l.id !== leadId))
    } catch {
      toast.error('Erro ao pesquisar')
    } finally {
      setSearching(false)
    }
  }

  async function handleMerge() {
    if (!selected) return
    setMerging(true)
    try {
      const res = await fetch('/api/leads/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ primary_id: leadId, secondary_id: selected.id }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Erro no merge')
        return
      }
      toast.success('Leads fundidas com sucesso')
      setOpen(false)
      router.push(`/dashboard/leads/${leadId}`)
      router.refresh()
    } catch {
      toast.error('Erro de ligação')
    } finally {
      setMerging(false)
      setConfirm(false)
    }
  }

  function handleClose() {
    setOpen(false)
    setSearch('')
    setResults([])
    setSelected(null)
    setConfirm(false)
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="gap-2 text-gray-500 hover:text-blue-600"
        onClick={() => setOpen(true)}
      >
        <Merge size={14} />
        Fundir lead
      </Button>

      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Merge size={16} className="text-blue-600" />
              Fundir Lead — {leadName}
            </DialogTitle>
            <DialogDescription>
              Pesquisa a lead duplicada a absorver. Todas as interações e tarefas serão movidas para <strong>{leadName}</strong>. A outra lead será eliminada.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex gap-2">
              <Input
                placeholder="Nome, telefone ou email..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
              />
              <Button variant="outline" onClick={handleSearch} disabled={searching}>
                {searching ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
              </Button>
            </div>

            {results.length > 0 && (
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {results.map(lead => (
                  <button
                    key={lead.id}
                    onClick={() => { setSelected(lead); setConfirm(false) }}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                      selected?.id === lead.id
                        ? 'bg-blue-50 border border-blue-200'
                        : 'hover:bg-gray-50 border border-transparent'
                    }`}
                  >
                    <div className="font-medium">{lead.full_name}</div>
                    <div className="text-xs text-gray-400">
                      {[lead.phone, lead.email].filter(Boolean).join(' · ')}
                    </div>
                  </button>
                ))}
              </div>
            )}

            {results.length === 0 && search && !searching && (
              <p className="text-sm text-gray-400 text-center py-2">Sem resultados para &quot;{search}&quot;</p>
            )}

            {selected && !confirm && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
                <strong>{selected.full_name}</strong> será absorvida por <strong>{leadName}</strong>. As suas interações e tarefas serão movidas. Esta ação é irreversível.
              </div>
            )}

            <div className="flex gap-2 justify-end pt-2">
              <Button variant="ghost" onClick={handleClose}>Cancelar</Button>
              {selected && !confirm && (
                <Button variant="destructive" onClick={() => setConfirm(true)}>
                  Confirmar merge
                </Button>
              )}
              {selected && confirm && (
                <Button variant="destructive" onClick={handleMerge} disabled={merging}>
                  {merging && <Loader2 size={14} className="animate-spin mr-1" />}
                  Sim, fundir agora
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
