'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { Pencil, Trash2, RefreshCw } from 'lucide-react'

export function InvestorActions({ id }: { id: string }) {
  const router = useRouter()
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    if (!confirm('Apagar este investidor? Esta ação não pode ser revertida.')) return
    setDeleting(true)
    const res = await fetch(`/api/investors/${id}`, { method: 'DELETE' })
    if (res.ok) {
      toast.success('Investidor apagado')
      router.push('/dashboard/investors')
    } else {
      const data = await res.json()
      toast.error(data.error || 'Erro ao apagar')
      setDeleting(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Link href={`/dashboard/investors/${id}/edit`}>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Pencil size={13} /> Editar
        </Button>
      </Link>
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5 text-red-600 hover:text-red-700 hover:border-red-300"
        onClick={handleDelete}
        disabled={deleting}
      >
        {deleting ? <RefreshCw size={13} className="animate-spin" /> : <Trash2 size={13} />}
        {deleting ? 'A apagar...' : 'Apagar'}
      </Button>
    </div>
  )
}
