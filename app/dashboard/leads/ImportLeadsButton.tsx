'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import { Upload, Loader2, Download } from 'lucide-react'

export function ImportLeadsButton() {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState<{ imported: number; skipped: number; errors: string[] } | null>(null)

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    const formData = new FormData()
    formData.append('file', file)

    try {
      const res = await fetch('/api/leads/import', { method: 'POST', body: formData })
      const data = await res.json()

      if (!res.ok) {
        toast.error(data.error || 'Erro ao importar')
        return
      }

      setResult(data)
      router.refresh()
    } catch {
      toast.error('Erro de ligação')
    } finally {
      setUploading(false)
      // Reset input para permitir re-upload do mesmo ficheiro
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".csv"
        className="hidden"
        onChange={handleFile}
      />

      <Button
        variant="outline"
        className="gap-2"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
      >
        {uploading ? (
          <>
            <Loader2 size={16} className="animate-spin" />
            A importar...
          </>
        ) : (
          <>
            <Upload size={16} />
            Importar CSV
          </>
        )}
      </Button>

      <Dialog open={!!result} onOpenChange={() => setResult(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Importação concluída</DialogTitle>
            <DialogDescription>
              Resultado da importação do ficheiro CSV.
            </DialogDescription>
          </DialogHeader>
          {result && (
            <div className="space-y-3">
              <div className="flex gap-6 p-4 bg-gray-50 rounded-lg">
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-600">{result.imported}</div>
                  <div className="text-xs text-gray-500">importadas</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-yellow-600">{result.skipped}</div>
                  <div className="text-xs text-gray-500">duplicadas ignoradas</div>
                </div>
              </div>

              {result.errors.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-red-600 mb-1">Erros:</p>
                  <ul className="space-y-1">
                    {result.errors.map((e, i) => (
                      <li key={i} className="text-xs text-red-600 bg-red-50 px-3 py-1.5 rounded">{e}</li>
                    ))}
                  </ul>
                </div>
              )}

              <a
                href="/templates/leads-template.csv"
                download
                className="flex items-center gap-2 text-sm text-blue-600 hover:underline"
              >
                <Download size={14} />
                Descarregar template CSV
              </a>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
