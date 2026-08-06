import { createClient } from '@/lib/supabase/server'
import {
  LISTING_STATUS_LABELS, LISTING_STATUS_COLORS, LISTING_PROPERTY_TYPE_LABELS,
  LISTING_BUSINESS_TYPE_LABELS, type ListingStatus, type ListingBusinessType, type ListingPropertyType,
} from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import Link from 'next/link'
import Image from 'next/image'
import { Plus, MapPin, BedDouble, Ruler, Home as HomeIcon, Chrome, Clock, Search, ChevronLeft, ChevronRight } from 'lucide-react'
import { ListingsSearchBar } from './ListingsSearchBar'
import { ListingsFilters } from './ListingsFilters'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 24

// Só as colunas usadas no card da grelha — evita trazer 'photos' (álbum
// completo) e 'description' (texto longo) que nunca são renderizados aqui.
const LISTING_CARD_COLUMNS = 'id, title, status, business_type, property_type, typology, price, area_useful_m2, area_gross_m2, days_on_market, municipality, zone, district, cover_image_url, created_at' as const

const STATUS_ORDER: ListingStatus[] = ['active', 'reserved', 'sold', 'withdrawn']
const BUSINESS_TYPES: ListingBusinessType[] = ['venda', 'arrendamento']
const PROPERTY_TYPES: ListingPropertyType[] = ['apartamento', 'moradia', 'terreno', 'comercial', 'garagem', 'outro']

interface Props {
  searchParams: Promise<{
    status?: string
    q?: string
    business_type?: string
    property_type?: string
    price_min?: string
    price_max?: string
    page?: string
  }>
}

function formatPrice(price: number | null): string {
  if (price == null) return 'Preço sob consulta'
  return new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(price)
}

/**
 * Sanitiza o termo de pesquisa para usar dentro de um filtro PostgREST .or().
 * Remove caracteres que podem partir o parser do Supabase (virgulas, parentesis,
 * percentagens literais) e o operador "*". Também limita o comprimento.
 */
function sanitizeQ(input: string): string {
  return input
    .replace(/[%,()*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
}

export default async function ListingsPage({ searchParams }: Props) {
  const { status, q: rawQ, business_type, property_type, price_min, price_max, page: rawPage } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: member } = await supabase
    .from('team_members')
    .select('team_id, role')
    .eq('user_id', user.id)
    .single()

  if (!member) return null

  const q = rawQ ? sanitizeQ(rawQ) : ''
  const activeStatus = status && STATUS_ORDER.includes(status as ListingStatus) ? (status as ListingStatus) : undefined
  const activeBusinessType = business_type && BUSINESS_TYPES.includes(business_type as ListingBusinessType) ? (business_type as ListingBusinessType) : undefined
  const activePropertyType = property_type && PROPERTY_TYPES.includes(property_type as ListingPropertyType) ? (property_type as ListingPropertyType) : undefined
  const priceMin = price_min ? Number(price_min) : undefined
  const priceMax = price_max ? Number(price_max) : undefined
  const page = rawPage && /^\d+$/.test(rawPage) && Number(rawPage) > 0 ? Number(rawPage) : 1

  let query = supabase
    .from('listings')
    .select(LISTING_CARD_COLUMNS, { count: 'exact' })
    .eq('team_id', member.team_id)
    .order('created_at', { ascending: false })

  if (activeStatus) query = query.eq('status', activeStatus)
  if (activeBusinessType) query = query.eq('business_type', activeBusinessType)
  if (activePropertyType) query = query.eq('property_type', activePropertyType)
  if (priceMin != null && !Number.isNaN(priceMin)) query = query.gte('price', priceMin)
  if (priceMax != null && !Number.isNaN(priceMax)) query = query.lte('price', priceMax)
  if (q.length > 0) {
    const pattern = `%${q}%`
    query = query.or(
      `title.ilike.${pattern},reference.ilike.${pattern},municipality.ilike.${pattern},zone.ilike.${pattern},address.ilike.${pattern}`
    )
  }

  const from = (page - 1) * PAGE_SIZE
  query = query.range(from, from + PAGE_SIZE - 1)

  const { data: listings, count } = await query
  const totalCount = count ?? 0
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const hasActiveFilters = Boolean(q || activeStatus || activeBusinessType || activePropertyType || priceMin != null || priceMax != null)

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4 md:space-y-5 overflow-x-hidden">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-xl md:text-2xl font-bold text-gray-900">Imóveis</h1>
          <p className="text-xs md:text-sm text-gray-500 mt-0.5">
            {totalCount} imóvel{totalCount === 1 ? '' : 'eis'}
            {q ? <> para <strong>&quot;{q}&quot;</strong></> : null}
            {!q && !hasActiveFilters ? ' — importa e faz match com as tuas leads compradoras' : null}
          </p>
        </div>
        {member.role !== 'viewer' && (
          <div className="flex items-center gap-2">
            <Link href="/dashboard/listings/import-tool">
              <Button variant="outline" size="sm" className="gap-1.5">
                <Chrome size={14} />
                <span className="hidden sm:inline">Bookmarklet</span>
              </Button>
            </Link>
            <Link href="/dashboard/listings/new">
              <Button size="sm" className="gap-1.5">
                <Plus size={14} />
                Importar Imóvel
              </Button>
            </Link>
          </div>
        )}
      </div>

      <ListingsSearchBar />

      <ListingsFilters />

      {/* Filtros de estado — scroll horizontal em mobile para nao quebrar o layout */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 md:mx-0 md:px-0 md:flex-wrap">
        {(() => {
          const baseParams = new URLSearchParams()
          if (q) baseParams.set('q', q)
          if (activeBusinessType) baseParams.set('business_type', activeBusinessType)
          if (activePropertyType) baseParams.set('property_type', activePropertyType)
          if (price_min) baseParams.set('price_min', price_min)
          if (price_max) baseParams.set('price_max', price_max)
          const baseQs = baseParams.toString()

          return (
            <>
              <Link href={baseQs ? `/dashboard/listings?${baseQs}` : '/dashboard/listings'}>
                <Badge variant={!activeStatus ? 'default' : 'outline'} className="cursor-pointer text-xs md:text-sm px-2.5 py-1 flex-shrink-0">
                  Todos
                </Badge>
              </Link>
              {STATUS_ORDER.map((s) => {
                const params = new URLSearchParams(baseParams)
                params.set('status', s)
                return (
                  <Link key={s} href={`/dashboard/listings?${params.toString()}`}>
                    <Badge variant={activeStatus === s ? 'default' : 'outline'} className="cursor-pointer text-xs md:text-sm px-2.5 py-1 flex-shrink-0 whitespace-nowrap">
                      {LISTING_STATUS_LABELS[s]}
                    </Badge>
                  </Link>
                )
              })}
            </>
          )
        })()}
      </div>

      {!listings || listings.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-dashed border-gray-200">
          {hasActiveFilters ? (
            <>
              <Search size={32} className="mx-auto text-gray-300 mb-3" />
              <p className="text-gray-500">Nenhum imóvel encontrado{q ? <> para <strong>&quot;{q}&quot;</strong></> : null}</p>
              <p className="text-xs text-gray-400 mt-1">Tenta outro termo ou ajusta os filtros</p>
              <div className="mt-4">
                <Link href="/dashboard/listings">
                  <Button variant="outline" size="sm">Limpar pesquisa e filtros</Button>
                </Link>
              </div>
            </>
          ) : (
            <>
              <HomeIcon size={32} className="mx-auto text-gray-300 mb-3" />
              <p className="text-gray-400 mb-4">Ainda não importaste nenhum imóvel</p>
              <Link href="/dashboard/listings/new">
                <Button variant="outline" className="gap-2">
                  <Plus size={16} />
                  Importar primeiro imóvel
                </Button>
              </Link>
            </>
          )}
        </div>
      ) : (
        <>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {listings.map((listing) => (
            <Link key={listing.id} href={`/dashboard/listings/${listing.id}`}>
              <Card className="hover:shadow-md transition-shadow cursor-pointer overflow-hidden h-full">
                {listing.cover_image_url && (
                  <div className="relative w-full h-36">
                    <Image
                      src={listing.cover_image_url}
                      alt={listing.title}
                      fill
                      sizes="(min-width: 1280px) 33vw, (min-width: 768px) 50vw, 100vw"
                      className="object-cover"
                    />
                  </div>
                )}
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <p className="font-semibold text-gray-900 truncate">{listing.title}</p>
                    <Badge className={`text-xs flex-shrink-0 ${LISTING_STATUS_COLORS[listing.status as ListingStatus]}`}>
                      {LISTING_STATUS_LABELS[listing.status as ListingStatus]}
                    </Badge>
                  </div>

                  <div className="text-lg font-bold text-gray-800 mb-2">{formatPrice(listing.price)}</div>

                  <div className="flex items-center gap-3 text-xs text-gray-400 flex-wrap">
                    <Badge variant="outline" className="text-xs">{LISTING_BUSINESS_TYPE_LABELS[listing.business_type as keyof typeof LISTING_BUSINESS_TYPE_LABELS]}</Badge>
                    <Badge variant="outline" className="text-xs">{LISTING_PROPERTY_TYPE_LABELS[listing.property_type as keyof typeof LISTING_PROPERTY_TYPE_LABELS]}</Badge>
                    {listing.typology && (
                      <span className="flex items-center gap-1"><BedDouble size={11} />{listing.typology}</span>
                    )}
                    {(listing.area_useful_m2 ?? listing.area_gross_m2) && (
                      <span className="flex items-center gap-1"><Ruler size={11} />{listing.area_useful_m2 ?? listing.area_gross_m2} m²</span>
                    )}
                    {listing.days_on_market != null && (
                      <span className="flex items-center gap-1"><Clock size={11} />{listing.days_on_market}d mercado</span>
                    )}
                  </div>

                  {(listing.municipality || listing.zone) && (
                    <div className="flex items-center gap-1 text-xs text-gray-400 mt-2">
                      <MapPin size={11} className="flex-shrink-0" />
                      <span className="truncate">{[listing.zone, listing.municipality, listing.district].filter(Boolean).join(', ')}</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>

        {totalPages > 1 && (() => {
          const pagerParams = new URLSearchParams()
          if (q) pagerParams.set('q', q)
          if (activeStatus) pagerParams.set('status', activeStatus)
          if (activeBusinessType) pagerParams.set('business_type', activeBusinessType)
          if (activePropertyType) pagerParams.set('property_type', activePropertyType)
          if (price_min) pagerParams.set('price_min', price_min)
          if (price_max) pagerParams.set('price_max', price_max)

          function hrefForPage(p: number) {
            const params = new URLSearchParams(pagerParams)
            if (p > 1) params.set('page', String(p))
            const qs = params.toString()
            return qs ? `/dashboard/listings?${qs}` : '/dashboard/listings'
          }

          return (
            <div className="flex items-center justify-center gap-3 pt-2">
              {page > 1 ? (
                <Link href={hrefForPage(page - 1)}>
                  <Button variant="outline" size="sm" className="gap-1"><ChevronLeft size={14} />Anterior</Button>
                </Link>
              ) : (
                <Button variant="outline" size="sm" className="gap-1" disabled><ChevronLeft size={14} />Anterior</Button>
              )}
              <span className="text-xs text-gray-500">Página {page} de {totalPages}</span>
              {page < totalPages ? (
                <Link href={hrefForPage(page + 1)}>
                  <Button variant="outline" size="sm" className="gap-1">Seguinte<ChevronRight size={14} /></Button>
                </Link>
              ) : (
                <Button variant="outline" size="sm" className="gap-1" disabled>Seguinte<ChevronRight size={14} /></Button>
              )}
            </div>
          )
        })()}
        </>
      )}
    </div>
  )
}
