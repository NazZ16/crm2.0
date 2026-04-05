// app/api/scraper/config/route.ts
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { hashApiKey } from '@/lib/api-keys'
import { NextResponse } from 'next/server'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const DEFAULT_CONFIG = {
  zones: [] as string[],
  max_price: 800000,
  typologies: [] as string[],
  enabled: true,
}

const ConfigSchema = z.object({
  zones: z.array(z.string().min(1)).min(1, 'Pelo menos uma zona obrigatória'),
  max_price: z.number().int().positive().max(10_000_000),
  typologies: z.array(z.string()),
  enabled: z.boolean().optional().default(true),
})

/** Resolve team_id via session cookie */
async function getTeamFromSession() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: member } = await supabase
    .from('team_members')
    .select('team_id, role')
    .eq('user_id', user.id)
    .single()

  return member ?? null
}

/** Resolve team_id via X-API-Key header */
async function getTeamFromApiKey(apiKey: string) {
  const hashed = hashApiKey(apiKey)
  const service = createServiceClient()

  const { data: keyRow } = await service
    .from('team_api_keys')
    .select('team_id')
    .eq('key_hash', hashed)
    .eq('active', true)
    .single()

  return keyRow ? { team_id: keyRow.team_id as string, role: 'admin' } : null
}

// GET /api/scraper/config
export async function GET(request: Request) {
  const apiKey = request.headers.get('X-API-Key')

  let member: { team_id: string; role: string } | null = null

  if (apiKey) {
    member = await getTeamFromApiKey(apiKey)
    if (!member) return NextResponse.json({ error: 'API key inválida' }, { status: 401 })
  } else {
    member = await getTeamFromSession()
    if (!member) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  }

  const service = createServiceClient()
  const { data, error } = await service
    .from('team_scraper_config')
    .select('zones, max_price, typologies, enabled')
    .eq('team_id', member.team_id)
    .single()

  if (error && error.code !== 'PGRST116') {
    // PGRST116 = no rows found — return defaults
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data ?? DEFAULT_CONFIG)
}

// PUT /api/scraper/config
export async function PUT(request: Request) {
  const member = await getTeamFromSession()
  if (!member) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  if (member.role !== 'admin') return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const parsed = ConfigSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Dados inválidos', details: parsed.error.flatten() }, { status: 400 })
  }

  const service = createServiceClient()
  const { data, error } = await service
    .from('team_scraper_config')
    .upsert(
      { team_id: member.team_id, ...parsed.data, updated_at: new Date().toISOString() },
      { onConflict: 'team_id' }
    )
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data)
}
