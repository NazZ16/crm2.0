'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import { Plus, Trash2, Copy, Check, Loader2 } from 'lucide-react'

interface ApiKey {
  id: string
  label: string
  key_prefix: string
  last_used_at: string | null
  revoked_at: string | null
  created_at: string
}

interface NewKeyResult extends ApiKey {
  key: string
}

export function ApiKeysSection({ isAdmin }: { isAdmin: boolean }) {
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [label, setLabel] = useState('')
  const [newKey, setNewKey] = useState<NewKeyResult | null>(null)
  const [copied, setCopied] = useState(false)
  const [revoking, setRevoking] = useState<string | null>(null)

  async function loadKeys() {
    const res = await fetch('/api/team/api-keys')
    if (res.ok) setKeys(await res.json())
    setLoading(false)
  }

  useEffect(() => { loadKeys() }, [])

  async function handleCreate() {
    if (!label.trim()) { toast.error('Adiciona um nome para a key'); return }
    setCreating(true)
    try {
      const res = await fetch('/api/team/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: label.trim() }),
      })
      if (res.ok) {
        const data: NewKeyResult = await res.json()
        setNewKey(data)
        setLabel('')
        loadKeys()
      } else {
        const err = await res.json()
        toast.error(err.error ?? 'Erro ao criar key')
      }
    } finally {
      setCreating(false)
    }
  }

  async function handleRevoke(id: string) {
    setRevoking(id)
    try {
      const res = await fetch(`/api/team/api-keys/${id}`, { method: 'DELETE' })
      if (res.ok) {
        toast.success('Key revogada')
        loadKeys()
      } else {
        toast.error('Erro ao revogar key')
      }
    } finally {
      setRevoking(null)
    }
  }

  function copyKey(key: string) {
    navigator.clipboard.writeText(key)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const activeKeys = keys.filter((k) => !k.revoked_at)

  if (!isAdmin) return null

  return (
    <>
      <div className="space-y-3">
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Label className="text-xs text-gray-500 mb-1 block">Nome da key (ex: Scraper Remax)</Label>
            <Input
              placeholder="Descrição da key"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            />
          </div>
          <Button onClick={handleCreate} disabled={creating} size="sm">
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />}
            Criar Key
          </Button>
        </div>

        {loading ? (
          <p className="text-sm text-gray-400">A carregar...</p>
        ) : activeKeys.length === 0 ? (
          <p className="text-sm text-gray-400">Sem keys activas. Cria uma para o scraper ou N8N.</p>
        ) : (
          <div className="space-y-2">
            {activeKeys.map((k) => (
              <div key={k.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border text-sm">
                <div>
                  <p className="font-medium text-gray-800">{k.label}</p>
                  <p className="text-gray-400 text-xs font-mono">
                    {k.key_prefix}••••••••
                    {k.last_used_at && (
                      <span className="ml-2">
                        · usado em {new Date(k.last_used_at).toLocaleDateString('pt-PT')}
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-emerald-700 border-emerald-300 text-xs">Activa</Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-red-500 hover:text-red-700 h-7 px-2"
                    onClick={() => handleRevoke(k.id)}
                    disabled={revoking === k.id}
                  >
                    {revoking === k.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        <p className="text-xs text-gray-400">
          Usa esta key no scraper como header <code className="bg-gray-100 px-1 rounded">X-API-Key</code>.
          A key só é mostrada uma vez na criação.
        </p>
      </div>

      {/* Modal — mostrar key UMA VEZ após criação */}
      <Dialog open={!!newKey} onOpenChange={() => setNewKey(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>API Key criada</DialogTitle>
            <DialogDescription>
              Copia esta key agora — <strong>não será mostrada novamente.</strong>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <p className="text-sm font-medium">{newKey?.label}</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-gray-100 p-3 rounded text-sm font-mono break-all">
                {newKey?.key}
              </code>
              <Button
                variant="outline"
                size="sm"
                onClick={() => newKey && copyKey(newKey.key)}
              >
                {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-xs text-gray-500">
              Adiciona ao ficheiro <code className="bg-gray-100 px-1 rounded">scrapers/.env</code>:
            </p>
            <code className="block bg-gray-100 p-2 rounded text-xs">
              SCRAPER_API_KEY={newKey?.key}
            </code>
          </div>

          <Button onClick={() => setNewKey(null)} className="w-full mt-2">
            Já copiei — fechar
          </Button>
        </DialogContent>
      </Dialog>
    </>
  )
}
