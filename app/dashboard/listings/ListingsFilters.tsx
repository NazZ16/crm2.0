'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { Input } from '@/components/ui/input'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { LISTING_BUSINESS_TYPE_LABELS, LISTING_PROPERTY_TYPE_LABELS } from '@/lib/types'
import { X } from 'lucide-react'

const ALL = '__all__'

/**
 * Filtros extra para a lista de imóveis: tipo de negócio, tipo de imóvel
 * e gama de preço. Sincronizam com a query string via router.replace,
 * tal como a search bar — o fetch acontece no Server Component da página.
 */
export function ListingsFilters() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [, startTransition] = useTransition()

  const businessType = searchParams.get('business_type') ?? ALL
  const propertyType = searchParams.get('property_type') ?? ALL
  const [priceMin, setPriceMin] = useState(searchParams.get('price_min') ?? '')
  const [priceMax, setPriceMax] = useState(searchParams.get('price_max') ?? '')
  const priceDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setPriceMin(searchParams.get('price_min') ?? '')
    setPriceMax(searchParams.get('price_max') ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.toString()])

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value && value !== ALL) {
      params.set(key, value)
    } else {
      params.delete(key)
    }
    const qs = params.toString()
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname)
    })
  }

  function handlePriceChange(key: 'price_min' | 'price_max', value: string) {
    if (key === 'price_min') setPriceMin(value)
    else setPriceMax(value)
    if (priceDebounceRef.current) clearTimeout(priceDebounceRef.current)
    priceDebounceRef.current = setTimeout(() => setParam(key, value), 400)
  }

  const hasFilters = businessType !== ALL || propertyType !== ALL || priceMin.length > 0 || priceMax.length > 0

  function clearFilters() {
    const params = new URLSearchParams(searchParams.toString())
    params.delete('business_type')
    params.delete('property_type')
    params.delete('price_min')
    params.delete('price_max')
    const qs = params.toString()
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname)
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={businessType} onValueChange={(v) => setParam('business_type', v)}>
        <SelectTrigger size="sm" className="w-[150px]">
          <SelectValue placeholder="Negócio" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Venda ou Arrendamento</SelectItem>
          {Object.entries(LISTING_BUSINESS_TYPE_LABELS).map(([value, label]) => (
            <SelectItem key={value} value={value}>{label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={propertyType} onValueChange={(v) => setParam('property_type', v)}>
        <SelectTrigger size="sm" className="w-[150px]">
          <SelectValue placeholder="Tipo de imóvel" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Todos os tipos</SelectItem>
          {Object.entries(LISTING_PROPERTY_TYPE_LABELS).map(([value, label]) => (
            <SelectItem key={value} value={value}>{label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex items-center gap-1">
        <Input
          type="number"
          inputMode="numeric"
          min={0}
          placeholder="Preço mín."
          value={priceMin}
          onChange={(e) => handlePriceChange('price_min', e.target.value)}
          className="w-24 h-8 text-xs"
        />
        <span className="text-gray-400 text-xs">—</span>
        <Input
          type="number"
          inputMode="numeric"
          min={0}
          placeholder="Preço máx."
          value={priceMax}
          onChange={(e) => handlePriceChange('price_max', e.target.value)}
          className="w-24 h-8 text-xs"
        />
      </div>

      {hasFilters && (
        <button
          type="button"
          onClick={clearFilters}
          className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600"
        >
          <X size={12} /> Limpar filtros
        </button>
      )}
    </div>
  )
}
