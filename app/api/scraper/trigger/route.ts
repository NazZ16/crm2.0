// app/api/scraper/trigger/route.ts
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const TriggerSchema = z.object({
  lead_id: z.string().uuid().optional(),
  zones: z.array(z.string()).optional(),
  max_price: z.number().int().positive().optional(),
  typologies: z.array(z.string()).optional(),
})

// POST /api/scraper/trigger
export async function POST(request: Request) {
  // 1. Session auth
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: member } = await supabase
    .from('team_members')
    .select('team_id, role')
    .eq('user_id', user.id)
    .single()

  if (!member) return NextResponse.json({ error: 'Equipa não encontrada' }, { status: 403 })
  if (member.role === 'viewer') return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })

  // 2. Parse body
  let body: unknown
  try {
    body = await request.json().catch(() => ({}))
  } catch {
    body = {}
  }

  const parsed = TriggerSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Dados inválidos', details: parsed.error.flatten() }, { status: 400 })
  }

  const { lead_id, zones: bodyZones, max_price: bodyMaxPrice, typologies: bodyTypologies } = parsed.data

  // 3. Resolve zones/max_price from config if not provided in body
  let zones = bodyZones
  let maxPrice = bodyMaxPrice
  let typologies = bodyTypologies

  if (!zones || !maxPrice) {
    const service = createServiceClient()
    const { data: config } = await service
      .from('team_scraper_config')
      .select('zones, max_price, typologies, enabled')
      .eq('team_id', member.team_id)
      .single()

    if (config) {
      zones = zones ?? (config.zones as string[])
      maxPrice = maxPrice ?? (config.max_price as number)
      typologies = typologies ?? (config.typologies as string[])
    }
  }

  // 4. Validate zones exist
  if (!zones || zones.length === 0) {
    return NextResponse.json(
      { error: 'Configura pelo menos uma zona em Definições → Scraper' },
      { status: 400 }
    )
  }

  // 5. Check env vars
  const githubToken = process.env.GITHUB_TOKEN
  const githubRepo = process.env.GITHUB_REPO

  if (!githubToken || !githubRepo) {
    return NextResponse.json(
      { error: 'Configuração GitHub em falta no servidor' },
      { status: 503 }
    )
  }

  // 6. Build inputs for workflow_dispatch
  const inputs: Record<string, string> = {
    zones: zones.join(','),
    max_price: String(maxPrice ?? 800000),
    typologies: (typologies ?? []).join(','),
  }
  if (lead_id) inputs.lead_id = lead_id

  // 7. Call GitHub Actions workflow_dispatch
  const dispatchUrl = `https://api.github.com/repos/${githubRepo}/actions/workflows/remax-scraper.yml/dispatches`

  let ghResponse: Response
  try {
    ghResponse = await fetch(dispatchUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${githubToken}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref: 'main', inputs }),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro de rede'
    return NextResponse.json({ error: `Falha a contactar GitHub: ${message}` }, { status: 502 })
  }

  // 8. GitHub returns 204 on success
  if (ghResponse.status === 204) {
    return NextResponse.json({ ok: true, message: 'Scraper acionado. O resultado chegará em ~5 minutos.' })
  }

  // 9. Handle GitHub API errors
  let ghError: unknown = null
  try {
    ghError = await ghResponse.json()
  } catch {
    ghError = await ghResponse.text().catch(() => 'Resposta ilegível')
  }

  return NextResponse.json(
    { error: 'Erro ao acionar GitHub Actions', status: ghResponse.status, details: ghError },
    { status: 502 }
  )
}
