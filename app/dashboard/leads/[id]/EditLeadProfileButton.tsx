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
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { Pencil, Loader2 } from 'lucide-react'
import type { ListingBusinessType } from '@/lib/types'

type TriState = 'indiferente' | 'sim' | 'nao'
type NegocioValue = 'qualquer' | ListingBusinessType

interface Props {
  leadId: string
  initialZonas: string[]
  initialTipologia: string | null
  initialTipoNegocio: ListingBusinessType | null
  initialAreaMin: number | null
  initialAreaMax: number | null
  initialGaragem: boolean | null
  initialElevador: boolean | null
  initialOrcamentoMax: number | null
}

function boolToTriState(v: boolean | null): TriState {
  if (v === true) return 'sim'
  if (v === false) return 'nao'
  return 'indiferente'
}

function triStateToBool(v: TriState): boolean | null {
  if (v === 'sim') return true
  if (v === 'nao') return false
  return null
}

function parseEur(input: string): number | null | 'invalid' {
  const trimmed = input.trim().replace(/\s+/g, '').replace(/\./g, '').replace(',', '.')
  if (trimmed.length === 0) return null
  const n = Number(trimmed)
  if (!Number.isFinite(n) || n < 0) return 'invalid'
  return Math.round(n * 100) / 100
}

function parseArea(input: string): number | null | 'invalid' {
  const trimmed = input.trim().replace(',', '.')
  if (trimmed.length === 0) return null
  const n = Number(trimmed)
  if (!Number.isFinite(n) || n < 0) return 'invalid'
  return n
}

export function EditLeadProfileButton({
  leadId,
  initialZonas,
  initialTipologia,
  initialTipoNegocio,
  initialAreaMin,
  initialAreaMax,
  initialGaragem,
  initialElevador,
  initialOrcamentoMax,
}: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  const [zonas, setZonas] = useState(initialZonas.join(', '))
  const [tipologia, setTipologia] = useState(initialTipologia ?? '')
  const [tipoNegocio, setTipoNegocio] = useState<NegocioValue>(initialTipoNegocio ?? 'qualquer')
  const [areaMin, setAreaMin] = useState(initialAreaMin != null ? String(initialAreaMin) : '')
  const [areaMax, setAreaMax] = useState(initialAreaMax != null ? String(initialAreaMax) : '')
  const [garagem, setGaragem] = useState<TriState>(boolToTriState(initialGaragem))
  const [elevador, setElevador] = useState<TriState>(boolToTriState(initialElevador))
  const [orcamentoMax, setOrcamentoMax] = useState(initialOrcamentoMax != null ? String(initialOrcamentoMax) : '')

  function reset() {
    setZonas(initialZonas.join(', '))
    setTipologia(initialTipologia ?? '')
    setTipoNegocio(initialTipoNegocio ?? 'qualquer')
    setAreaMin(initialAreaMin != null ? String(initialAreaMin) : '')
    setAreaMax(initialAreaMax != null ? String(initialAreaMax) : '')
    setGaragem(boolToTriState(initialGaragem))
    setElevador(boolToTriState(initialElevador))
    setOrcamentoMax(initialOrcamentoMax != null ? String(initialOrcamentoMax) : '')
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset()
    setOpen(next)
  }

  async function handleSave() {
    const areaMinParsed = parseArea(areaMin)
    if (areaMinParsed === 'invalid') {
      toast.error('Área mínima inválida')
      return
    }
    const areaMaxParsed = parseArea(areaMax)
    if (areaMaxParsed === 'invalid') {
      toast.error('Área máxima inválida')
      return
    }
    if (typeof areaMinParsed === 'number' && typeof areaMaxParsed === 'number' && areaMinParsed > areaMaxParsed) {
      toast.error('Área mínima não pode ser maior que a máxima')
      return
    }
    const orcamentoParsed = parseEur(orcamentoMax)
    if (orcamentoParsed === 'invalid') {
      toast.error('Orçamento inválido')
      return
    }

    const payload = {
      home_preferences: {
        zonas: zonas.split(',').map((z) => z.trim()).filter((z) => z.length > 0),
        tipologia: tipologia.trim().length > 0 ? tipologia.trim() : null,
        tipo_negocio: tipoNegocio === 'qualquer' ? null : tipoNegocio,
        area_min: areaMinParsed,
        area_max: areaMaxParsed,
        garagem: triStateToBool(garagem),
        elevador: triStateToBool(elevador),
      },
      financial_profile: {
        orcamento_max: orcamentoParsed,
      },
    }

    setSaving(true)
    try {
      const res = await fetch(`/api/leads/${leadId}/profile`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? 'Erro ao guardar')
        return
      }
      toast.success('Perfil de compra atualizado')
      setOpen(false)
      router.refresh()
    } catch {
      toast.error('Erro de ligação')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0"
        onClick={() => setOpen(true)}
        title="Editar perfil de compra manualmente"
      >
        <Pencil size={13} />
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Editar perfil de compra</DialogTitle>
            <DialogDescription>
              Estes campos são normalmente preenchidos pela IA a partir das chamadas — corrige ou
              preenche aqui quando ainda não houver conversa suficiente.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="edit-profile-negocio">Procura</Label>
              <Select value={tipoNegocio} onValueChange={(v) => setTipoNegocio(v as NegocioValue)}>
                <SelectTrigger id="edit-profile-negocio" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="qualquer">Não definido</SelectItem>
                  <SelectItem value="venda">Comprar</SelectItem>
                  <SelectItem value="arrendamento">Arrendar</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="edit-profile-zonas">Zonas</Label>
              <Input
                id="edit-profile-zonas"
                value={zonas}
                onChange={(e) => setZonas(e.target.value)}
                placeholder="Cascais, Oeiras, Lisboa"
              />
              <p className="text-xs text-gray-400">Separadas por vírgula.</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="edit-profile-tipologia">Tipologia</Label>
              <Input
                id="edit-profile-tipologia"
                value={tipologia}
                onChange={(e) => setTipologia(e.target.value)}
                placeholder="T2"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="edit-profile-area-min">Área mín. (m²)</Label>
                <Input
                  id="edit-profile-area-min"
                  inputMode="decimal"
                  value={areaMin}
                  onChange={(e) => setAreaMin(e.target.value)}
                  placeholder="60"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-profile-area-max">Área máx. (m²)</Label>
                <Input
                  id="edit-profile-area-max"
                  inputMode="decimal"
                  value={areaMax}
                  onChange={(e) => setAreaMax(e.target.value)}
                  placeholder="100"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="edit-profile-garagem">Garagem</Label>
                <Select value={garagem} onValueChange={(v) => setGaragem(v as TriState)}>
                  <SelectTrigger id="edit-profile-garagem" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="indiferente">Indiferente</SelectItem>
                    <SelectItem value="sim">Sim</SelectItem>
                    <SelectItem value="nao">Não</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-profile-elevador">Elevador</Label>
                <Select value={elevador} onValueChange={(v) => setElevador(v as TriState)}>
                  <SelectTrigger id="edit-profile-elevador" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="indiferente">Indiferente</SelectItem>
                    <SelectItem value="sim">Sim</SelectItem>
                    <SelectItem value="nao">Não</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="edit-profile-orcamento">Orçamento máximo (EUR)</Label>
              <Input
                id="edit-profile-orcamento"
                inputMode="decimal"
                value={orcamentoMax}
                onChange={(e) => setOrcamentoMax(e.target.value)}
                placeholder="300000"
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving} className="gap-1.5">
              {saving ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  A guardar...
                </>
              ) : (
                'Guardar'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
