'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { CalendarDays, Loader2, Check, X } from 'lucide-react'
import { toast } from 'sonner'

interface Props {
  connectedEmail: string | null
  hasWriteScope?: boolean
  hasContactsScope?: boolean
  pendingContactsSyncCount?: number
  flashMessage: { type: 'success' | 'error'; text: string } | null
}

export function GoogleCalendarSection({
  connectedEmail,
  hasWriteScope = false,
  hasContactsScope = false,
  pendingContactsSyncCount = 0,
  flashMessage,
}: Props) {
  const router = useRouter()
  const [disconnecting, setDisconnecting] = useState(false)
  const [syncing, setSyncing] = useState(false)

  async function handleSyncContacts() {
    setSyncing(true)
    try {
      const res = await fetch('/api/leads/sync-google-contacts', { method: 'POST' })
      const json = await res.json()
      if (res.ok) {
        toast.success(`${json.synced} sincronizadas${json.failed ? `, ${json.failed} falharam` : ''}`)
        router.refresh()
      } else {
        toast.error(json.error ?? 'Erro ao sincronizar')
      }
    } finally {
      setSyncing(false)
    }
  }

  async function handleDisconnect() {
    if (!confirm('Tens a certeza que queres desligar a conta Google?')) return
    setDisconnecting(true)
    try {
      const res = await fetch('/api/auth/google/disconnect', { method: 'POST' })
      if (res.ok) {
        toast.success('Conta Google desligada')
        router.refresh()
      } else {
        toast.error('Erro ao desligar')
      }
    } finally {
      setDisconnecting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <CalendarDays size={16} />
          Google Calendar & Contactos
          {connectedEmail ? (
            <span className="ml-auto text-xs font-normal text-green-600 bg-green-50 px-2 py-0.5 rounded-full flex items-center gap-1">
              <Check size={12} /> Ligado
            </span>
          ) : (
            <span className="ml-auto text-xs font-normal text-gray-500 bg-gray-50 px-2 py-0.5 rounded-full">
              Nao ligado
            </span>
          )}
        </CardTitle>
        <CardDescription>
          Liga a tua conta Google para veres a agenda de hoje no dashboard e para sincronizar as tuas leads com os
          Contactos Google — assim, quando uma lead te ligar, o telemóvel mostra logo o nome.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {flashMessage && (
          <div
            className={`text-xs px-3 py-2 rounded-lg ${
              flashMessage.type === 'success'
                ? 'bg-green-50 text-green-700 border border-green-100'
                : 'bg-red-50 text-red-700 border border-red-100'
            }`}
          >
            {flashMessage.text}
          </div>
        )}

        {connectedEmail ? (
          <>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="text-sm text-gray-700">
                Ligado a <strong>{connectedEmail}</strong>
              </div>
              <Button variant="outline" size="sm" onClick={handleDisconnect} disabled={disconnecting} className="gap-1.5">
                {disconnecting ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
                Desligar
              </Button>
            </div>
            {(!hasWriteScope || !hasContactsScope) && (
              <div className="text-xs px-3 py-2 rounded-lg bg-amber-50 text-amber-800 border border-amber-100 flex items-start gap-2">
                <span className="flex-1">
                  <strong>Permissoes incompletas:</strong>{' '}
                  {!hasWriteScope && !hasContactsScope
                    ? 'falta permissao para adicionar tasks ao calendar e para sincronizar contactos.'
                    : !hasWriteScope
                    ? 'falta permissao para adicionar tasks ao calendar.'
                    : 'falta permissao para sincronizar leads com os Contactos Google.'}{' '}
                  Re-liga (vai pedir-te uma nova autorizacao).
                </span>
                <a href="/api/auth/google/start">
                  <Button size="sm" className="h-7 gap-1 bg-amber-600 hover:bg-amber-700 text-white whitespace-nowrap">
                    Re-ligar
                  </Button>
                </a>
              </div>
            )}
            {hasContactsScope && pendingContactsSyncCount > 0 && (
              <div className="text-xs px-3 py-2 rounded-lg bg-blue-50 text-blue-800 border border-blue-100 flex items-center gap-2">
                <span className="flex-1">
                  {pendingContactsSyncCount} lead{pendingContactsSyncCount === 1 ? '' : 's'} com telefone ainda
                  não sincronizada{pendingContactsSyncCount === 1 ? '' : 's'} como contacto Google.
                </span>
                <Button
                  size="sm"
                  onClick={handleSyncContacts}
                  disabled={syncing}
                  className="h-7 gap-1 bg-blue-600 hover:bg-blue-700 text-white whitespace-nowrap"
                >
                  {syncing ? <Loader2 size={14} className="animate-spin" /> : null}
                  Sincronizar agora
                </Button>
              </div>
            )}
          </>
        ) : (
          <div className="space-y-2">
            <a href="/api/auth/google/start">
              <Button size="sm" className="gap-1.5 bg-blue-600 hover:bg-blue-700 text-white">
                <CalendarDays size={14} />
                Ligar Google Calendar
              </Button>
            </a>
            <p className="text-xs text-gray-500">
              Vamos pedir permissao para gerir a tua agenda e os teus Contactos Google. Os tokens ficam guardados no servidor — nada e exposto no cliente.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
