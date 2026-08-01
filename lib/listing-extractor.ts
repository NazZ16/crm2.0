// lib/listing-extractor.ts
// Extração determinística (regex, zero chamadas Claude) de dados de imóvel a
// partir do HTML colado de páginas de backoffice/portais (ex: Maxwork/RE-MAX).
// Best-effort: quando um campo não é encontrado fica null e o utilizador
// preenche/corrige no formulário de revisão antes de guardar.

import type { ListingBusinessType, ListingExtractionResult, ListingPropertyType } from './types'

function decodeEntities(str: string): string {
  return str
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
}

function stripTags(html: string): string {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim()
}

function parseNumber(raw: string | null): number | null {
  if (!raw) return null
  // Captura só o primeiro número contíguo (aceita espaço como separador de
  // milhares "345 000" e ponto/vírgula decimal), parando antes de texto como
  // "m²"/"m2" ou "€" — evita colar o "2" de "m²" ao valor (ex.: "580 m2" → 580, não 5802).
  const match = raw.match(/-?\d[\d\s]*(?:[.,]\d+)?/)
  if (!match) return null
  const token = match[0].replace(/\s/g, '')
  if (!token) return null
  // Portugues: "345.000,50" ou "345000" (sem decimais) → normalizar para float JS
  const normalized = token.includes(',')
    ? token.replace(/\./g, '').replace(',', '.')
    : token
  const n = parseFloat(normalized)
  return Number.isFinite(n) ? n : null
}

function parseInt10(raw: string | null): number | null {
  const n = parseNumber(raw)
  return n === null ? null : Math.round(n)
}

function extractByDataId(html: string, dataId: string): string | null {
  const re = new RegExp(`<dd[^>]*data-id="${dataId}"[^>]*>([\\s\\S]*?)<\\/dd>`, 'i')
  const m = html.match(re)
  if (!m) return null
  const text = stripTags(m[1]).trim()
  return text.length > 0 ? text : null
}

function extractByLabel(html: string, label: string): string | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`<dt[^>]*>\\s*${escaped}\\s*:?\\s*<\\/dt>\\s*<dd[^>]*>([\\s\\S]*?)<\\/dd>`, 'i')
  const m = html.match(re)
  if (!m) return null
  const text = stripTags(m[1]).trim()
  return text.length > 0 ? text : null
}

function extractFirst(html: string, re: RegExp): string | null {
  const m = html.match(re)
  return m ? stripTags(m[1]).trim() || null : null
}

function mapBusinessType(raw: string | null): ListingBusinessType | null {
  if (!raw) return null
  const v = raw.toLowerCase()
  if (v.includes('arrend')) return 'arrendamento'
  if (v.includes('venda')) return 'venda'
  return null
}

function mapPropertyType(raw: string | null): ListingPropertyType | null {
  if (!raw) return null
  const v = raw.toLowerCase()
  if (v.includes('moradia')) return 'moradia'
  if (v.includes('apartamento')) return 'apartamento'
  if (v.includes('terreno')) return 'terreno'
  if (v.includes('garagem')) return 'garagem'
  if (v.includes('loja') || v.includes('escritório') || v.includes('escritorio') || v.includes('comercial') || v.includes('armazém') || v.includes('armazem')) return 'comercial'
  return 'outro'
}

function boolFromYesNo(raw: string | null): boolean | null {
  if (!raw) return null
  const v = raw.trim().toLowerCase()
  if (v === 'sim') return true
  if (v === 'não' || v === 'nao') return false
  return null
}

/** Nº de quartos/tipologia (ex.: "8" → 8, "T3" → 3). */
function parseTypologyNumber(raw: string | null): number | null {
  if (!raw) return null
  const m = raw.match(/(\d+)/)
  return m ? parseInt(m[1], 10) : null
}

export function extractListingFromHtml(raw: string): ListingExtractionResult {
  const html = raw

  const reference = extractByDataId(html, 'listingTitle')
  const businessTypeRaw = extractByDataId(html, 'businessType')
  const listingTypeRaw = extractByDataId(html, 'listingType')

  const title =
    extractByLabel(html, 'Título') ||
    extractFirst(html, /<h3[^>]*>([\s\S]*?)<\/h3>/i) ||
    null

  const priceRaw =
    extractByLabel(html, 'Preço do Imóvel') ||
    extractByLabel(html, 'Preço de Aquisição')

  const condoFeeRaw = extractByLabel(html, 'Valor Condomínio')
  const imiRaw = extractByLabel(html, 'Valor de IMI')

  const zipCode = extractByDataId(html, 'zipCode')
  const address = extractByDataId(html, 'address')
  const district = extractByDataId(html, 'regionName1')
  const municipality = extractByDataId(html, 'regionName2')
  const parish = extractByDataId(html, 'regionName3')
  const latitude = parseNumber(extractByDataId(html, 'latitude'))
  const longitude = parseNumber(extractByDataId(html, 'longitude'))

  const areaUseful = parseNumber(extractByDataId(html, 'livingArea'))
  const areaGross = parseNumber(extractByDataId(html, 'builtArea')) ?? parseNumber(extractByDataId(html, 'totalArea'))
  const areaPlot = parseNumber(extractByDataId(html, 'lotSize'))

  const bedrooms = parseTypologyNumber(extractByDataId(html, 'typology'))
  const bathrooms = parseInt10(extractByDataId(html, 'numberOfBathrooms'))
  const totalRooms = parseInt10(extractByDataId(html, 'totalRooms'))
  const parkingSpaces = parseTypologyNumber(extractByDataId(html, 'garageType'))
  const hasElevator = boolFromYesNo(extractByLabel(html, 'Elevador'))
  const constructionYear = parseInt10(extractByDataId(html, 'constructionYear'))
  const energyRating = extractByDataId(html, 'energyEfficiencyLevel')

  // Características (chips) — <label id="X" class="custom-button-chips form-label">Texto<p></p></label>
  const features: string[] = []
  const featureRe = /<label[^>]*class="custom-button-chips[^>]*>([\s\S]*?)<p>/gi
  let fm: RegExpExecArray | null
  while ((fm = featureRe.exec(html)) !== null) {
    const text = stripTags(fm[1]).trim()
    if (text) features.push(text)
  }

  // Descrição — texto dentro do card de descrição (ignora o seletor de idioma)
  const descBlock = html.match(/id="listing-summary-description"[\s\S]*?<div class="mt-1 card-body"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/i)
    || html.match(/id="listing-description"[\s\S]*?<div class="mt-1 card-body"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/i)
  let description: string | null = null
  if (descBlock) {
    const ddMatches = [...descBlock[1].matchAll(/<dd[^>]*>([\s\S]*?)<\/dd>/gi)]
    const texts = ddMatches.map((m) => stripTags(m[1]).trim()).filter(Boolean)
    // A descrição longa costuma ser o texto mais extenso encontrado
    description = texts.sort((a, b) => b.length - a.length)[0] ?? null
  }

  const coverImageMatch = html.match(/src="(https:\/\/i\.maxwork\.pt\/mxw-650\/[^"]+)"/i)
    || html.match(/src="(https:\/\/i\.maxwork\.pt\/mxw-200\/[^"]+)"/i)
  const coverImageUrl = coverImageMatch ? coverImageMatch[1] : null

  const sourceUrlMatch = html.match(/href="(https:\/\/(?:www\.)?remax\.pt\/[^"]+)"/i)
  const sourceUrl = sourceUrlMatch ? sourceUrlMatch[1] : null

  return {
    reference,
    title,
    business_type: mapBusinessType(businessTypeRaw),
    property_type: mapPropertyType(listingTypeRaw),
    typology: bedrooms !== null ? `T${bedrooms}` : null,
    price: parseNumber(priceRaw),
    condo_fee: parseNumber(condoFeeRaw),
    imi_annual: parseNumber(imiRaw),
    district,
    municipality,
    parish,
    address,
    zip_code: zipCode,
    latitude,
    longitude,
    area_useful_m2: areaUseful,
    area_gross_m2: areaGross,
    area_plot_m2: areaPlot,
    bedrooms,
    bathrooms,
    total_rooms: totalRooms,
    parking_spaces: parkingSpaces,
    has_elevator: hasElevator,
    construction_year: constructionYear,
    energy_rating: energyRating,
    features,
    description,
    cover_image_url: coverImageUrl,
    source_url: sourceUrl,
  }
}
