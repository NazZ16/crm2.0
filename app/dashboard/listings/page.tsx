import { createClient } from '@/lib/supabase/server'
import {
  LISTING_STATUS_LABELS, LISTING_STATUS_COLORS, LISTING_PROPERTY_TYPE_LABELS,
  LISTING_BUSINESS_TYPE_LABELS, type ListingStatus,
} from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import Link from 'next/link'
import { Plus, MapPin, BedDouble, Ruler, Home as HomeIcon, Chrome, Clock } from 'lucide-react'

export const dynamic = 'force-dynamic'

const STATUS_ORDER: ListingStatus[] = ['active', 'reserved', 'sold', 'withdrawn']

interface Props {
  searchParams: Promise<{ status?: string }>
}

function formatPrice(price: number | null): string {
  if (price == null) return 'Preço sob consulta'
  return new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(price)
}

export default async function ListingsPage({ searchParams }: Props) {
  const { status } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: member } = await supabase
    .from('team_members')
    .select('team_id, role')
    .eq('user_id', user.id)
    .single()

  if (!member) return null

  let query = supabase
    .from('listings')
    .select('*')
    .eq('team_id', member.team_id)
    .order('created_at', { ascending: false })

  const activeStatus = status && STATUS_ORDER.includes(status as ListingStatus) ? (status as ListingStatus) : undefined
  if (activeStatus) query = query.eq('status', activeStatus)

  const { data: listings } = await query

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4 md:space-y-5 overflow-x-hidden">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-xl md:text-2xl font-bold text-gray-900">Imóveis</h1>
          <p className="text-xs md:text-sm text-gray-500 mt-0.5">
            {listings?.length ?? 0} imóvel{listings?.length === 1 ? '' : 'eis'} — importa e faz match com as tuas leads compradoras
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

      <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 md:mx-0 md:px-0 md:flex-wrap">
        <Link href="/dashboard/listings">
          <Badge variant={!activeStatus ? 'default' : 'outline'} className="cursor-pointer text-xs md:text-sm px-2.5 py-1 flex-shrink-0">
            Todos
          </Badge>
        </Link>
        {STATUS_ORDER.map((s) => (
          <Link key={s} href={`/dashboard/listings?status=${s}`}>
            <Badge variant={activeStatus === s ? 'default' : 'outline'} className="cursor-pointer text-xs md:text-sm px-2.5 py-1 flex-shrink-0 whitespace-nowrap">
              {LISTING_STATUS_LABELS[s]}
            </Badge>
          </Link>
        ))}
      </div>

      {!listings || listings.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-dashed border-gray-200">
          <HomeIcon size={32} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-400 mb-4">Ainda não importaste nenhum imóvel</p>
          <Link href="/dashboard/listings/new">
            <Button variant="outline" className="gap-2">
              <Plus size={16} />
              Importar primeiro imóvel
            </Button>
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {listings.map((listing) => (
            <Link key={listing.id} href={`/dashboard/listings/${listing.id}`}>
              <Card className="hover:shadow-md transition-shadow cursor-pointer overflow-hidden h-full">
                {listing.cover_image_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={listing.cover_image_url} alt={listing.title} className="w-full h-36 object-cover" />
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
      )}
    </div>
  )
}
