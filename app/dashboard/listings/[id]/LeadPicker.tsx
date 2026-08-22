'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'
import { Loader2, Search, UserPlus } from 'lucide-react'
import { LEAD_TYPE_LABELS, type LeadType } from '@/lib/types'

interface LeadResult {
  id: string
  full_name: string
  phone: string | null
  email: string | null
  lead_type: LeadType
}

interface Props {
  defaultLeadType: 'seller' | 'buyer'
  onSelect: (lead: LeadResult) => void
  onCancel?: () => void
}

// Pesquisa uma lead existente (nome/telefone/email) para ligar a este anúncio;
// se não encontrar nada, cria uma nova lead com esse nome. Modelado no mesmo
// padrão de pesquisa do MergeLeadsButton (app/dashboard/leads/MergeLeadsButton.tsx).
export function LeadPicker({ defaultLeadType, onSelect, onCancel }: Props) {
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<LeadResult[]>([])
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)
  const [creating, setCreating] = useState(false)

  async function handleSearch() {
    if (!search.trim()) return
    setSearching(true)
    try {
      const res = await fetch(`/api/leads?q=${encodeURIComponent(search)}&limit=10`)
      const data = await res.json()
      setResults(Array.isArray(data) ? data : [])
    } catch {
      toast.error('Erro ao pesquisar')
    } finally {
      setSearching(false)
      setSearched(true)
    }
  }

  async function handleCreate() {
    if (!search.trim()) return
    setCreating(true)
    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name: search.trim(), lead_type: defaultLeadType }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Erro ao criar lead')
        return
      }
      toast.success('Lead criada')
      onSelect({ ...data, lead_type: defaultLeadType })
    } catch {
      toast.error('Erro de ligação')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input
          placeholder="Nome, telefone ou email..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setSearched(false) }}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          autoFocus
        />
        <Button variant="outline" size="sm" onClick={handleSearch} disabled={searching || !search.trim()}>
          {searching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
        </Button>
      </div>

      {results.length > 0 && (
        <div className="space-y-1 max-h-48 overflow-y-auto">
          {results.map((lead) => (
            <button
              key={lead.id}
              type="button"
              onClick={() => onSelect(lead)}
              className="w-full text-left px-3 py-2 rounded-lg text-sm border border-transparent hover:bg-gray-50 hover:border-gray-200 transition-colors"
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">{lead.full_name}</span>
                <span className="text-[10px] text-gray-400">{LEAD_TYPE_LABELS[lead.lead_type]}</span>
              </div>
              <div className="text-xs text-gray-400">{[lead.phone, lead.email].filter(Boolean).join(' · ')}</div>
            </button>
          ))}
        </div>
      )}

      {searched && !searching && results.length === 0 && (
        <div className="space-y-2">
          <p className="text-sm text-gray-400">Sem resultados para &quot;{search}&quot;.</p>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={handleCreate} disabled={creating}>
            {creating ? <Loader2 size={13} className="animate-spin" /> : <UserPlus size={13} />}
            Criar nova lead &quot;{search}&quot;
          </Button>
        </div>
      )}

      {onCancel && (
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={onCancel}>Cancelar</Button>
        </div>
      )}
    </div>
  )
}
