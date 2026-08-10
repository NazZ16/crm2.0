import OpenAI from 'openai'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { HomePreferences, Listing } from './types'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export const EMBEDDING_MODEL = 'text-embedding-3-small'
export const EMBEDDING_DIMENSIONS = 1536

/**
 * Gera o embedding de um texto. Best-effort: nunca lanca — devolve null e
 * regista um aviso se a API OpenAI falhar (rate limit, timeout, chave
 * invalida, etc). Quem chama trata null como "sem camada semantica agora",
 * nunca como motivo para bloquear a operacao que despoletou a chamada
 * (criar/editar um listing, aplicar uma extracao).
 */
export async function generateEmbedding(text: string): Promise<number[] | null> {
  const clean = text.trim()
  if (!clean) return null
  try {
    const res = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: clean,
      dimensions: EMBEDDING_DIMENSIONS,
    })
    return res.data[0]?.embedding ?? null
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[embeddings] generateEmbedding falhou: ${msg}`)
    return null
  }
}

/**
 * Converte o valor devolvido pelo PostgREST para number[]. Colunas pgvector
 * chegam como string no formato "[0.01,0.02,...]" via supabase-js, nao como
 * array nativo.
 */
export function parseEmbedding(raw: unknown): number[] | null {
  if (raw == null) return null
  if (Array.isArray(raw)) return raw as number[]
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? (parsed as number[]) : null
    } catch {
      return null
    }
  }
  return null
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

type ListingForEmbedding = Pick<
  Listing,
  | 'title'
  | 'description'
  | 'zone'
  | 'municipality'
  | 'parish'
  | 'district'
  | 'typology'
  | 'property_type'
  | 'business_type'
  | 'features'
  | 'price'
>

export function buildListingEmbeddingText(listing: ListingForEmbedding): string {
  const parts = [
    listing.title,
    listing.business_type === 'arrendamento' ? 'Para arrendar' : 'Para vender',
    listing.property_type,
    listing.typology,
    [listing.zone, listing.parish, listing.municipality, listing.district].filter(Boolean).join(', '),
    listing.price ? `Preço: ${listing.price}€` : null,
    listing.features?.length ? `Características: ${listing.features.join(', ')}` : null,
    listing.description,
  ]
  return parts.filter((p): p is string => !!p && p.trim().length > 0).join('. ')
}

export function buildLeadPreferenceEmbeddingText(
  prefs: HomePreferences | null,
  leadNotes: string | null = null
): string {
  const parts = [
    prefs?.zonas?.length ? `Procura em: ${prefs.zonas.join(', ')}` : null,
    prefs?.tipologia ? `Tipologia: ${prefs.tipologia}` : null,
    prefs?.exterior ? 'Quer espaço exterior' : null,
    prefs?.garagem ? 'Quer garagem' : null,
    prefs?.elevador ? 'Quer elevador' : null,
    prefs?.notas,
    leadNotes,
  ]
  return parts.filter((p): p is string => !!p && p.trim().length > 0).join('. ')
}

/** Gera e persiste o embedding de um listing. Best-effort — nunca lanca. */
export async function regenerateListingEmbedding(
  supabase: SupabaseClient,
  listingId: string,
  text: string
): Promise<void> {
  const embedding = await generateEmbedding(text)
  if (!embedding) return
  const { error } = await supabase
    .from('listings')
    .update({ embedding, embedding_updated_at: new Date().toISOString() })
    .eq('id', listingId)
  if (error) console.warn(`[embeddings] falha ao gravar embedding do listing ${listingId}: ${error.message}`)
}

/** Gera e persiste o embedding do perfil de preferencias de uma lead. Best-effort. */
export async function regenerateLeadProfileEmbedding(
  supabase: SupabaseClient,
  leadId: string,
  text: string
): Promise<void> {
  const embedding = await generateEmbedding(text)
  if (!embedding) return
  const { error } = await supabase
    .from('lead_profiles')
    .update({ embedding, embedding_updated_at: new Date().toISOString() })
    .eq('lead_id', leadId)
  if (error) console.warn(`[embeddings] falha ao gravar embedding da lead ${leadId}: ${error.message}`)
}
