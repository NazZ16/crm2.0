'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Download, CheckCircle2, Smartphone } from 'lucide-react'

type InstallState = 'checking' | 'available' | 'installed' | 'unsupported'

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function PwaInstallButton() {
  const [state, setState] = useState<InstallState>('checking')
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [installing, setInstalling] = useState(false)

  useEffect(() => {
    // Já está instalada como PWA (modo standalone)
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setState('installed')
      return
    }

    // iOS Safari — não suporta beforeinstallprompt, mas pode ser instalada
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent)
    const isSafari = /safari/i.test(navigator.userAgent) && !/chrome/i.test(navigator.userAgent)
    if (isIos && isSafari) {
      setState('available') // mostra instruções manuais
      return
    }

    const handler = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
      setState('available')
    }

    window.addEventListener('beforeinstallprompt', handler)

    // Timeout: se não disparar em 3s, provavelmente não suporta
    const timer = setTimeout(() => {
      setState((prev) => (prev === 'checking' ? 'unsupported' : prev))
    }, 3000)

    return () => {
      window.removeEventListener('beforeinstallprompt', handler)
      clearTimeout(timer)
    }
  }, [])

  async function handleInstall() {
    if (!deferredPrompt) return
    setInstalling(true)
    await deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    if (outcome === 'accepted') {
      setState('installed')
    }
    setDeferredPrompt(null)
    setInstalling(false)
  }

  // Já instalada
  if (state === 'installed') {
    return (
      <div className="flex items-center gap-2 text-sm text-green-600">
        <CheckCircle2 size={16} />
        App já está instalada no dispositivo
      </div>
    )
  }

  // iOS — instruções manuais
  const isIos = typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent)
  if (state === 'available' && isIos) {
    return (
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800 space-y-1">
        <div className="flex items-center gap-2 font-medium">
          <Smartphone size={16} />
          Instalar no iPhone / iPad
        </div>
        <p>Toca em <strong>Partilhar</strong> (ícone de caixa com seta) e depois em <strong>&quot;Adicionar ao ecrã inicial&quot;</strong>.</p>
      </div>
    )
  }

  // Chrome / Android — botão nativo
  if (state === 'available' && deferredPrompt) {
    return (
      <Button onClick={handleInstall} disabled={installing} className="gap-2">
        <Download size={16} />
        {installing ? 'A instalar...' : 'Instalar app no dispositivo'}
      </Button>
    )
  }

  // A verificar ou não suportado — não mostrar nada para não poluir
  return null
}
