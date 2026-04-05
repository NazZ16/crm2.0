'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { X, Plus, Play, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react'

interface ScraperConfig {
  zones: string[]
  max_price: number
  typologies: string[]
  enabled: boolean
}

interface Props {
  initialConfig: ScraperConfig
}

const TYPOLOGY_OPTIONS = ['T0', 'T1', 'T2', 'T3', 'T4', 'T4+']

export function ScraperConfigSection({ initialConfig }: Props) {
  const [config, setConfig] = useState<ScraperConfig>(initialConfig)
  const [newZone, setNewZone] = useState('')
  const [saving, setSaving] = useState(false)
  const [triggering, setTriggering] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle')
  const [triggerStatus, setTriggerStatus] = useState<'idle' | 'triggered' | 'error'>('idle')
  const [triggerMessage, setTriggerMessage] = useState('')

  function addZone() {
    const z = newZone.trim()
    if (!z || config.zones.includes(z)) return
    setConfig(c => ({ ...c, zones: [...c.zones, z] }))
    setNewZone('')
  }

  function removeZone(zone: string) {
    setConfig(c => ({ ...c, zones: c.zones.filter(z => z !== zone) }))
  }

  function toggleTypology(t: string) {
    setConfig(c => ({
      ...c,
      typologies: c.typologies.includes(t)
        ? c.typologies.filter(x => x !== t)
        : [...c.typologies, t],
    }))
  }

  async function handleSave() {
    setSaving(true)
    setSaveStatus('idle')
    const resp = await fetch('/api/scraper/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    })
    setSaving(false)
    setSaveStatus(resp.ok ? 'saved' : 'error')
    setTimeout(() => setSaveStatus('idle'), 3000)
  }

  async function handleTrigger() {
    setTriggering(true)
    setTriggerStatus('idle')
    const resp = await fetch('/api/scraper/trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    const json = await resp.json().catch(() => ({}))
    setTriggering(false)
    if (resp.ok) {
      setTriggerStatus('triggered')
      setTriggerMessage(json.message ?? 'Scraper acionado!')
    } else {
      setTriggerStatus('error')
      setTriggerMessage(json.error ?? 'Erro ao acionar scraper')
    }
    setTimeout(() => setTriggerStatus('idle'), 5000)
  }

  return (
    <div className="space-y-5">
      {/* Zonas */}
      <div>
        <p className="text-sm font-medium text-gray-700 mb-2">Zonas de pesquisa</p>
        <div className="flex flex-wrap gap-2 mb-2">
          {config.zones.map(z => (
            <Badge key={z} variant="outline" className="flex items-center gap-1 pr-1">
              {z}
              <button onClick={() => removeZone(z)} className="ml-1 hover:text-red-500">
                <X size={10} />
              </button>
            </Badge>
          ))}
        </div>
        <div className="flex gap-2">
          <Input
            value={newZone}
            onChange={e => setNewZone(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addZone()}
            placeholder="ex: Lisboa, Cascais, Porto..."
            className="max-w-xs text-sm"
          />
          <Button variant="outline" size="sm" onClick={addZone}>
            <Plus size={14} />
          </Button>
        </div>
      </div>

      {/* Preço máximo */}
      <div>
        <p className="text-sm font-medium text-gray-700 mb-2">Preço máximo (€)</p>
        <Input
          type="number"
          value={config.max_price}
          onChange={e => setConfig(c => ({ ...c, max_price: parseInt(e.target.value) || 0 }))}
          className="max-w-xs text-sm"
          min={0}
          max={10000000}
          step={10000}
        />
      </div>

      {/* Tipologias */}
      <div>
        <p className="text-sm font-medium text-gray-700 mb-2">Tipologias</p>
        <div className="flex flex-wrap gap-2">
          {TYPOLOGY_OPTIONS.map(t => (
            <button
              key={t}
              onClick={() => toggleTypology(t)}
              className={`px-3 py-1 rounded-full text-sm font-medium border transition-colors ${
                config.typologies.includes(t)
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-400 mt-1">Nenhuma selecionada = todas as tipologias</p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 pt-2 flex-wrap">
        <Button onClick={handleSave} disabled={saving} size="sm">
          {saving ? <Loader2 size={14} className="animate-spin mr-2" /> : null}
          Guardar configuração
        </Button>
        <Button onClick={handleTrigger} disabled={triggering} variant="outline" size="sm"
          className="flex items-center gap-2">
          {triggering ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
          Acionar scraper agora
        </Button>
        {saveStatus === 'saved' && (
          <span className="flex items-center gap-1 text-sm text-green-600">
            <CheckCircle2 size={14} /> Guardado
          </span>
        )}
        {saveStatus === 'error' && (
          <span className="flex items-center gap-1 text-sm text-red-500">
            <AlertCircle size={14} /> Erro ao guardar
          </span>
        )}
        {triggerStatus !== 'idle' && (
          <span className={`flex items-center gap-1 text-sm ${triggerStatus === 'triggered' ? 'text-green-600' : 'text-red-500'}`}>
            {triggerStatus === 'triggered' ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
            {triggerMessage}
          </span>
        )}
      </div>
    </div>
  )
}
