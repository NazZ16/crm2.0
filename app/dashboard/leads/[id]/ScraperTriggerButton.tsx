'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Search, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'

interface Props {
  leadId: string
  zones?: string[]
  maxPrice?: number
  typologies?: string[]
}

export function ScraperTriggerButton({ leadId, zones, maxPrice, typologies }: Props) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [message, setMessage] = useState('')

  async function handleTrigger() {
    setStatus('loading')
    const resp = await fetch('/api/scraper/trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lead_id: leadId,
        ...(zones && zones.length > 0 ? { zones } : {}),
        ...(maxPrice ? { max_price: maxPrice } : {}),
        ...(typologies && typologies.length > 0 ? { typologies } : {}),
      }),
    })
    const json = await resp.json().catch(() => ({}))
    if (resp.ok) {
      setStatus('done')
      setMessage(json.message ?? 'Scraper acionado!')
    } else {
      setStatus('error')
      setMessage(json.error ?? 'Erro ao acionar')
    }
    setTimeout(() => setStatus('idle'), 6000)
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={handleTrigger}
        disabled={status === 'loading'}
        className="flex items-center gap-2"
      >
        {status === 'loading'
          ? <Loader2 size={14} className="animate-spin" />
          : <Search size={14} />}
        Pesquisar Imóveis
      </Button>
      {status === 'done' && (
        <span className="flex items-center gap-1 text-xs text-green-600">
          <CheckCircle2 size={12} /> {message}
        </span>
      )}
      {status === 'error' && (
        <span className="flex items-center gap-1 text-xs text-red-500">
          <AlertCircle size={12} /> {message}
        </span>
      )}
    </div>
  )
}
