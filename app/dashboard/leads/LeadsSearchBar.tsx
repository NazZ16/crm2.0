'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Search, X, Loader2 } from 'lucide-react'

/**
 * Search bar para a lista de leads. Pesquisa em nome, telefone e email.
 * Sincroniza com query string via router.replace (sem fazer push para o
 * histórico em cada tecla). Tem debounce de 300ms para evitar refetch
 * a cada caractere.
 */
export function LeadsSearchBar() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [pending, startTransition] = useTransition()

  const initial = searchParams.get('q') ?? ''
  const [value, setValue] = useState(initial)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Quando o utilizador navega para a pagina com uma URL ja com 'q', sincroniza
  // o estado local (caso entre directamente em /dashboard/leads?q=foo).
  useEffect(() => {
    setValue(searchParams.get('q') ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.toString()])

  function pushQuery(next: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (next.trim().length > 0) {
      params.set('q', next.trim())
    } else {
      params.delete('q')
    }
    const qs = params.toString()
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname)
    })
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.value
    setValue(next)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => pushQuery(next), 300)
  }

  function handleClear() {
    setValue('')
    if (debounceRef.current) clearTimeout(debounceRef.current)
    pushQuery('')
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      handleClear()
      ;(e.target as HTMLInputElement).blur()
    }
    if (e.key === 'Enter') {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      pushQuery(value)
    }
  }

  return (
    <div className="relative w-full sm:max-w-md">
      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
      <Input
        type="search"
        inputMode="search"
        autoComplete="off"
        spellCheck={false}
        placeholder="Procurar por nome, telefone ou email..."
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        className="pl-9 pr-9"
      />
      {pending ? (
        <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 animate-spin" />
      ) : value.length > 0 ? (
        <button
          type="button"
          onClick={handleClear}
          aria-label="Limpar pesquisa"
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100"
        >
          <X size={14} />
        </button>
      ) : null}
    </div>
  )
}
