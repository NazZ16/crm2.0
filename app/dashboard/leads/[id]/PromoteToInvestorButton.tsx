'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { TrendingUp, Loader2 } from 'lucide-react'

interface Props {
  leadId: string
  leadName: string
  suggestedZones?: string[]
  suggestedBudgetMax?: number
}

export function PromoteToInvestorButton({ leadId, leadName, suggestedZones, suggestedBudgetMax }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [budgetMin, setBudgetMin] = useState('')
  const [budgetMax, setBudgetMax] = useState(suggestedBudgetMax?.toString() ?? '')
  const [zones, setZones] = useState(suggestedZones?.join(', ') ?? '')

  async function handlePromote() {
    setLoading(true)
    try {
      const res = await fetch(`/api/leads/${leadId}/promote-to-investor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          budget_min: budgetMin ? parseInt(budgetMin) : null,
          budget_max: budgetMax ? parseInt(budgetMax) : null,
          preferred_zones: zones ? zones.split(',').map((z) => z.trim()).filter(Boolean) : [],
        }),
      })

      if (res.ok) {
        const investor = await res.json()
        toast.success(`${leadName} promovido a investidor`)
        setOpen(false)
        router.push(`/dashboard/investors/${investor.id}`)
      } else {
        const err = await res.json()
        toast.error(err.error ?? 'Erro ao promover')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <TrendingUp className="mr-2 h-4 w-4" />
        Promover a Investidor
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Promover {leadName} a Investidor</DialogTitle>
            <DialogDescription>
              Cria um perfil de investidor pré-preenchido. O histórico de interações mantém-se no lead original.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Budget mínimo (€)</Label>
                <Input
                  type="number"
                  placeholder="ex: 100000"
                  value={budgetMin}
                  onChange={(e) => setBudgetMin(e.target.value)}
                />
              </div>
              <div>
                <Label>Budget máximo (€)</Label>
                <Input
                  type="number"
                  placeholder="ex: 300000"
                  value={budgetMax}
                  onChange={(e) => setBudgetMax(e.target.value)}
                />
              </div>
            </div>
            <div>
              <Label>Zonas preferidas (separadas por vírgula)</Label>
              <Input
                placeholder="ex: Lisboa, Cascais, Sintra"
                value={zones}
                onChange={(e) => setZones(e.target.value)}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={handlePromote} disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Promover
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
