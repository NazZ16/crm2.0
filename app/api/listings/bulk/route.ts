import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { listingSchema } from '@/lib/schemas/listing'

export const maxDuration = 60

const INSERT_CHUNK_SIZE = 50
const UPDATE_CONCURRENCY = 10
const MAX_ROWS_PER_REQUEST = 200

const bulkSchema = z.object({
  listings: z.array(z.record(z.string(), z.unknown())).min(1).max(MAX_ROWS_PER_REQUEST),
})

type BulkError = { index: number; source_url?: string | null; message: string }

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))
  return chunks
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const service = createServiceClient()

  // Mesma lógica de auth do POST single-row em ../route.ts (API key para
  // scrapers, sessão para o resto) — duplicada de propósito para não mexer
  // no endpoint que já está em uso.
  const apiKey = request.headers.get('X-API-Key')
  let teamId: string | null = null

  if (apiKey) {
    const { hashApiKey } = await import('@/lib/api-keys')
    const keyHash = hashApiKey(apiKey)
    const { data: apiKeyRow } = await service
      .from('team_api_keys')
      .select('team_id, id')
      .eq('key_hash', keyHash)
      .is('revoked_at', null)
      .single()

    if (apiKeyRow) {
      teamId = apiKeyRow.team_id
      void Promise.resolve(
        service
          .from('team_api_keys')
          .update({ last_used_at: new Date().toISOString() })
          .eq('id', apiKeyRow.id)
      ).catch(() => {})
    }
  }

  if (!teamId) {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

    const { data: member } = await supabase
      .from('team_members')
      .select('team_id, role')
      .eq('user_id', user.id)
      .single()

    if (!member || member.role === 'viewer') {
      return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
    }
    teamId = member.team_id
  }

  const body = await request.json()
  const parsedBody = bulkSchema.safeParse(body)
  if (!parsedBody.success) {
    return NextResponse.json({ error: parsedBody.error.flatten() }, { status: 400 })
  }

  const rawRows = parsedBody.data.listings
  const errors: BulkError[] = []

  // Valida cada linha individualmente — uma linha inválida não deve chumbar
  // o lote todo (o scraper envia até 200 de cada vez).
  const validRows: { index: number; raw: Record<string, unknown>; data: z.infer<typeof listingSchema> }[] = []
  rawRows.forEach((raw, index) => {
    const parsed = listingSchema.safeParse(raw)
    if (!parsed.success) {
      errors.push({ index, source_url: (raw.source_url as string) ?? null, message: parsed.error.message })
      return
    }
    validRows.push({ index, raw, data: parsed.data })
  })

  // Prefetch — um único SELECT para saber quais source_url já existem,
  // em vez de uma query por linha (mesma técnica de app/api/leads/import).
  const urls = [...new Set(validRows.map(r => r.data.source_url).filter((u): u is string => !!u))]
  const existingByUrl = new Map<string, string>()
  if (urls.length > 0) {
    const { data: existing } = await service
      .from('listings')
      .select('id, source_url')
      .eq('team_id', teamId)
      .in('source_url', urls)
    existing?.forEach(row => {
      if (row.source_url) existingByUrl.set(row.source_url, row.id)
    })
  }

  type ToInsert = { index: number; source_url: string | null; payload: Record<string, unknown> }
  type ToUpdate = { index: number; source_url: string; id: string; payload: Record<string, unknown> }

  const toInsert: ToInsert[] = []
  const toUpdate: ToUpdate[] = []

  for (const row of validRows) {
    const existingId = row.data.source_url ? existingByUrl.get(row.data.source_url) : undefined
    if (existingId && row.data.source_url) {
      // Só atualiza as keys que vieram mesmo no pedido — preserva dados
      // ricos já guardados quando o scraper reenvia um payload "leve".
      const sentKeys = Object.keys(row.raw)
      const parsedData = row.data as unknown as Record<string, unknown>
      const updatePayload: Record<string, unknown> = { updated_at: new Date().toISOString() }
      for (const key of sentKeys) {
        if (key === 'lead_id' || key === 'notes') continue
        if (key in parsedData) updatePayload[key] = parsedData[key]
      }
      toUpdate.push({ index: row.index, source_url: row.data.source_url, id: existingId, payload: updatePayload })
    } else {
      toInsert.push({ index: row.index, source_url: row.data.source_url ?? null, payload: { ...row.data, team_id: teamId } })
    }
  }

  let inserted = 0
  let updated = 0

  // Insert em chunks. Se um chunk falhar por violação da constraint única
  // (corrida entre o prefetch e o insert, ou source_url repetido dentro do
  // próprio lote), refaz esse chunk linha-a-linha e trata cada colisão
  // como update em vez de erro.
  for (const insertChunk of chunk(toInsert, INSERT_CHUNK_SIZE)) {
    const { error } = await service.from('listings').insert(insertChunk.map(r => r.payload)).select('id')
    if (!error) {
      inserted += insertChunk.length
      continue
    }

    if (error.code === '23505') {
      for (const row of insertChunk) {
        const { error: rowError } = await service.from('listings').insert(row.payload).select('id').single()
        if (!rowError) {
          inserted++
          continue
        }
        if (rowError.code === '23505' && row.source_url) {
          const { data: nowExisting } = await service
            .from('listings')
            .select('id')
            .eq('team_id', teamId)
            .eq('source_url', row.source_url)
            .maybeSingle()
          if (nowExisting) {
            const { error: updateError } = await service
              .from('listings')
              .update({ ...row.payload, updated_at: new Date().toISOString() })
              .eq('id', nowExisting.id)
            if (!updateError) {
              updated++
              continue
            }
            errors.push({ index: row.index, source_url: row.source_url, message: updateError.message })
          }
        } else {
          errors.push({ index: row.index, source_url: row.source_url, message: rowError.message })
        }
      }
    } else {
      insertChunk.forEach(row => errors.push({ index: row.index, source_url: row.source_url, message: error.message }))
    }
  }

  // Update com concorrência limitada — cada linha tem um SET diferente,
  // não dá para juntar num único statement via supabase-js.
  for (const updateChunk of chunk(toUpdate, UPDATE_CONCURRENCY)) {
    const results = await Promise.all(
      updateChunk.map(row =>
        service.from('listings').update(row.payload).eq('id', row.id).then(({ error }) => ({ row, error }))
      )
    )
    for (const { row, error } of results) {
      if (error) errors.push({ index: row.index, source_url: row.source_url, message: error.message })
      else updated++
    }
  }

  const skipped = rawRows.length - inserted - updated

  return NextResponse.json({ inserted, updated, skipped, errors })
}
