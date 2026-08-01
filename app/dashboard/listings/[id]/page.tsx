'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  LISTING_STATUS_LABELS, LISTING_STATUS_COLORS, LISTING_PROPERTY_TYPE_LABELS,
  LISTING_BUSINESS_TYPE_LABELS,
  type Listing, type ListingStatus, type ListingMatchResult,
} from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { toast } from 'sonner'
import {
  ArrowLeft, MapPin, BedDouble, Bath, Ruler, Car, Zap, RefreshCw,
  Trash2, ExternalLink, CheckCircle2, AlertCircle, Users, UserRound, Phone, Mail,
  ChevronLeft, ChevronRight,
} from 'lucide-react'

function formatPrice(price: number | null): string {
  if (price == null) return 'Sob consulta'
  return new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(price)
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center py-1 border-b border-gray-50 text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-gray-900 text-right">{value}</span>
    </div>
  )
}

function PhotoCarousel({ photos, title }: { photos: string[]; title: string }) {
  const [index, setIndex] = useState(0)
  const [lightboxOpen, setLightboxOpen] = useState(false)

  if (photos.length === 0) return null

  const prev = (e?: React.MouseEvent) => { e?.stopPropagation(); setIndex((i) => (i - 1 + photos.length) % photos.length) }
  const next = (e?: React.MouseEvent) => { e?.stopPropagation(); setIndex((i) => (i + 1) % photos.length) }

  return (
    <>
      <div className="relative rounded-xl border overflow-hidden bg-gray-50">
        <button type="button" onClick={() => setLightboxOpen(true)} className="block w-full cursor-zoom-in">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photos[index]} alt={`${title} — foto ${index + 1}`} className="w-full max-h-96 object-cover" />
        </button>
        {photos.length > 1 && (
          <>
            <button type="button" onClick={prev} aria-label="Foto anterior"
              className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-full p-1.5">
              <ChevronLeft size={18} />
            </button>
            <button type="button" onClick={next} aria-label="Foto seguinte"
              className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-full p-1.5">
              <ChevronRight size={18} />
            </button>
            <span className="absolute bottom-2 right-2 bg-black/60 text-white text-xs px-2 py-0.5 rounded-full">
              {index + 1}/{photos.length}
            </span>
          </>
        )}
      </div>

      <Dialog open={lightboxOpen} onOpenChange={setLightboxOpen}>
        <DialogContent className="max-w-[99vw] sm:max-w-[99vw] w-fit p-0 border-0 bg-transparent shadow-none [&_button[data-slot=dialog-close]]:text-white [&_button[data-slot=dialog-close]]:bg-black/50 [&_button[data-slot=dialog-close]]:rounded-full [&_button[data-slot=dialog-close]]:p-1">
          <DialogTitle className="sr-only">{title} — foto {index + 1}</DialogTitle>
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photos[index]} alt={`${title} — foto ${index + 1}`} className="max-w-[99vw] max-h-[98vh] w-auto h-auto object-contain rounded-lg" />
            {photos.length > 1 && (
              <>
                <button type="button" onClick={prev} aria-label="Foto anterior"
                  className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-full p-2">
                  <ChevronLeft size={22} />
                </button>
                <button type="button" onClick={next} aria-label="Foto seguinte"
                  className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-full p-2">
                  <ChevronRight size={22} />
                </button>
                <span className="absolute bottom-2 right-2 bg-black/60 text-white text-xs px-2 py-0.5 rounded-full">
                  {index + 1}/{photos.length}
                </span>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

export default function ListingDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [listing, setListing] = useState<Listing | null>(null)
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState(false)
  const [updatingStatus, setUpdatingStatus] = useState(false)
  const [matches, setMatches] = useState<ListingMatchResult[] | null>(null)
  const [matchesLoading, setMatchesLoading] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(`/api/listings/${id}`)
    if (!res.ok) { router.push('/dashboard/listings'); return }
    setListing(await res.json())
    setLoading(false)
  }, [id, router])

  useEffect(() => { load() }, [load])

  const loadMatches = useCallback(async () => {
    setMatchesLoading(true)
    const res = await fetch(`/api/listings/${id}/matches`)
    if (res.ok) setMatches(await res.json())
    setMatchesLoading(false)
  }, [id])

  useEffect(() => { loadMatches() }, [loadMatches])

  async function updateStatus(status: ListingStatus) {
    setUpdatingStatus(true)
    const res = await fetch(`/api/listings/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    if (res.ok) { toast.success('Estado atualizado'); await load() } else { toast.error('Erro ao atualizar') }
    setUpdatingStatus(false)
  }

  async function deleteListing() {
    if (!confirm('Apagar este imóvel? Esta ação não pode ser revertida.')) return
    setDeleting(true)
    const res = await fetch(`/api/listings/${id}`, { method: 'DELETE' })
    if (res.ok) {
      toast.success('Imóvel apagado')
      router.push('/dashboard/listings')
    } else {
      toast.error('Erro ao apagar')
      setDeleting(false)
    }
  }

  if (loading) return <div className="p-6 text-gray-400">A carregar...</div>
  if (!listing) return null

  const location = [listing.address, listing.zone, listing.parish, listing.municipality, listing.district]
    .filter(Boolean)
    .join(', ')

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/listings" className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1">
            <ArrowLeft size={14} />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-gray-900">{listing.title}</h1>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <Badge className={LISTING_STATUS_COLORS[listing.status]}>{LISTING_STATUS_LABELS[listing.status]}</Badge>
              <Badge variant="outline" className="text-xs">{LISTING_BUSINESS_TYPE_LABELS[listing.business_type]}</Badge>
              <Badge variant="outline" className="text-xs">{LISTING_PROPERTY_TYPE_LABELS[listing.property_type]}</Badge>
              {listing.reference && <span className="text-xs text-gray-400">Ref. {listing.reference}</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Select value={listing.status} onValueChange={(v) => updateStatus(v as ListingStatus)} disabled={updatingStatus}>
            <SelectTrigger className="h-8 text-xs w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(LISTING_STATUS_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
          {listing.source_url && (
            <a href={listing.source_url} target="_blank" rel="noreferrer">
              <Button variant="outline" size="sm" className="gap-1.5"><ExternalLink size={13} /> Anúncio</Button>
            </a>
          )}
          <Button variant="outline" size="sm" className="gap-1.5 text-red-600 hover:text-red-700 hover:border-red-300"
            onClick={deleteListing} disabled={deleting}>
            {deleting ? <RefreshCw size={13} className="animate-spin" /> : <Trash2 size={13} />}
            {deleting ? 'A apagar...' : 'Apagar'}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <PhotoCarousel
            photos={listing.photos.length > 0 ? listing.photos : listing.cover_image_url ? [listing.cover_image_url] : []}
            title={listing.title}
          />

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Detalhes</CardTitle></CardHeader>
            <CardContent className="space-y-1">
              <Row label="Preço" value={formatPrice(listing.price)} />
              {listing.condo_fee != null && <Row label="Condomínio" value={`${listing.condo_fee} €/mês`} />}
              {listing.imi_annual != null && <Row label="IMI anual" value={formatPrice(listing.imi_annual)} />}
              {listing.typology && <Row label="Tipologia" value={listing.typology} />}
              {listing.construction_year && <Row label="Ano de construção" value={String(listing.construction_year)} />}
              {listing.energy_rating && <Row label="Classe energética" value={listing.energy_rating} />}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Áreas e Divisões</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                {listing.area_useful_m2 != null && (
                  <div className="flex items-center gap-1.5"><Ruler size={14} className="text-gray-400" /> {listing.area_useful_m2} m² úteis</div>
                )}
                {listing.area_gross_m2 != null && (
                  <div className="flex items-center gap-1.5"><Ruler size={14} className="text-gray-400" /> {listing.area_gross_m2} m² brutos</div>
                )}
                {listing.bedrooms != null && (
                  <div className="flex items-center gap-1.5"><BedDouble size={14} className="text-gray-400" /> {listing.bedrooms} quartos</div>
                )}
                {listing.bathrooms != null && (
                  <div className="flex items-center gap-1.5"><Bath size={14} className="text-gray-400" /> {listing.bathrooms} WC</div>
                )}
                {listing.parking_spaces != null && listing.parking_spaces > 0 && (
                  <div className="flex items-center gap-1.5"><Car size={14} className="text-gray-400" /> {listing.parking_spaces} lugares</div>
                )}
                {listing.has_elevator != null && (
                  <div className="flex items-center gap-1.5"><Zap size={14} className="text-gray-400" /> {listing.has_elevator ? 'Com elevador' : 'Sem elevador'}</div>
                )}
              </div>
            </CardContent>
          </Card>

          {location && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-1.5"><MapPin size={14} /> Localização</CardTitle></CardHeader>
              <CardContent className="text-sm text-gray-700">
                {location}
                {listing.zip_code && <span className="text-gray-400"> · {listing.zip_code}</span>}
              </CardContent>
            </Card>
          )}

          {listing.features.length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Características</CardTitle></CardHeader>
              <CardContent className="flex flex-wrap gap-1.5">
                {listing.features.map((f) => (
                  <Badge key={f} variant="outline" className="text-xs">{f}</Badge>
                ))}
              </CardContent>
            </Card>
          )}

          {listing.description && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Descrição</CardTitle></CardHeader>
              <CardContent className="text-sm text-gray-700 whitespace-pre-line">{listing.description}</CardContent>
            </Card>
          )}

          {listing.notes && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Notas privadas</CardTitle></CardHeader>
              <CardContent className="text-sm text-gray-700 whitespace-pre-line">{listing.notes}</CardContent>
            </Card>
          )}
        </div>

        {/* ── Matching com leads ── */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-1.5"><Users size={14} /> Leads compatíveis</CardTitle>
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" onClick={loadMatches} disabled={matchesLoading}>
                  <RefreshCw size={11} className={matchesLoading ? 'animate-spin' : ''} /> Atualizar
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {matchesLoading && !matches ? (
                <p className="text-xs text-gray-400">A calcular matches...</p>
              ) : !matches || matches.length === 0 ? (
                <p className="text-xs text-gray-400">
                  Sem leads compradoras compatíveis por agora. Verifica se as leads têm preferências (zona, tipologia, orçamento) preenchidas.
                </p>
              ) : (
                <div className="space-y-3">
                  {matches.map((m) => (
                    <div key={m.lead_id} className="p-2.5 rounded-lg border border-gray-100">
                      <div className="flex items-center justify-between mb-1">
                        <Link href={`/dashboard/leads/${m.lead_id}`} className="font-medium text-sm text-gray-900 hover:text-blue-600">
                          {m.lead_name}
                        </Link>
                        <span className="text-sm font-bold text-gray-700">{m.score}<span className="text-xs text-gray-400">/100</span></span>
                      </div>
                      <div className="space-y-0.5">
                        {m.reasons.slice(0, 3).map((r, i) => (
                          <div key={i} className="flex items-center gap-1 text-xs text-gray-600">
                            {r.positive ? <CheckCircle2 size={10} className="text-green-500 flex-shrink-0" /> : <AlertCircle size={10} className="text-orange-400 flex-shrink-0" />}
                            {r.reason}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {(listing.agent_name || listing.agent_phone || listing.agent_email) && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-1.5"><UserRound size={14} /> Agente</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5 text-sm">
                {listing.agent_name && (
                  <div className="flex items-center gap-1.5 font-medium text-gray-900">
                    <UserRound size={13} className="text-gray-400" /> {listing.agent_name}
                  </div>
                )}
                {listing.agent_phone && (
                  <a href={`tel:${listing.agent_phone}`} className="flex items-center gap-1.5 text-gray-700 hover:text-blue-600">
                    <Phone size={13} className="text-gray-400" /> {listing.agent_phone}
                  </a>
                )}
                {listing.agent_email && (
                  <a href={`mailto:${listing.agent_email}`} className="flex items-center gap-1.5 text-gray-700 hover:text-blue-600">
                    <Mail size={13} className="text-gray-400" /> {listing.agent_email}
                  </a>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
