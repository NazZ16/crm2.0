import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { normalizePhone } from '@/lib/phone'

const createLeadSchema = z.object({
  full_name: z.string().min(1).max(200),
  phone: z.string().max(30).optional(),
  email: z.string().email().optional(),
  source: z.string().max(100).optional(),
  notes: z.string().max(2000).optional(),
  campaign_id: z.string().uuid().optional(),
  lead_type: z.enum(['buyer', 'seller', 'both', 'unknown']).optional(),
})

export async function GET(request: Request) {
  const supabase = await createClient()
  const service = createServiceClient()

  // Suporta autenticação por API key (usado pela extensão de browser para
  // verificar duplicados por telefone antes de criar um lead), no mesmo
  // padrão de /api/listings.
  const apiKey = request.headers.get('X-API-Key')
  let teamId: string | null = null
  let usedApiKey = false

  if (apiKey) {
    const { hashApiKey } = await import('@/lib/api-keys')
    const keyHash = hashApiKey(apiKey)
    const { data: apiKeyRow } = await service
      .from('team_api_keys')
      .select('team_id')
      .eq('key_hash', keyHash)
      .is('revoked_at', null)
      .single()
    if (apiKeyRow) {
      teamId = apiKeyRow.team_id
      usedApiKey = true
    }
  }

  if (!teamId) {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

    const { data: member } = await supabase
      .from('team_members')
      .select('team_id')
      .eq('user_id', user.id)
      .single()

    if (!member) return NextResponse.json({ error: 'Equipa não encontrada' }, { status: 403 })
    teamId = member.team_id
  }

  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')
  const q = searchParams.get('q') ?? searchParams.get('search')
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') ?? '50') || 50, 1), 200)
  const offset = parseInt(searchParams.get('offset') ?? '0')

  let query = (usedApiKey ? service : supabase)
    .from('leads')
    .select(`
      id, full_name, phone, email, source, status, score, urgency,
      last_contact_at, next_action_at, created_at, assigned_to, campaign_id, tags, notes
    `)
    .eq('team_id', teamId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (status) query = query.eq('status', status)
  if (q) {
    const safe = q.replace(/[%_\\]/g, '\\$&')
    query = query.or(`full_name.ilike.%${safe}%,phone.ilike.%${safe}%,email.ilike.%${safe}%`)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data)
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const service = createServiceClient()

  // Suporta autenticação por API key para a extensão de browser (sem cookie
  // de sessão), no mesmo padrão de /api/listings — permite criar leads FSBO
  // diretamente a partir da página do anúncio.
  const apiKey = request.headers.get('X-API-Key')
  let teamId: string | null = null
  let assignedTo: string | null = null
  let usedApiKey = false

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
      usedApiKey = true
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
    assignedTo = user.id
  } else {
    // Não há sessão de utilizador na chamada por API key — atribui ao único
    // membro da equipa (CRM de um único utilizador, ver CLAUDE.md).
    const { data: member } = await service
      .from('team_members')
      .select('user_id')
      .eq('team_id', teamId)
      .limit(1)
      .maybeSingle()
    assignedTo = member?.user_id ?? null
  }

  const body = await request.json()
  const parsed = createLeadSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Dados inválidos', details: parsed.error.flatten() }, { status: 400 })
  }

  const db = usedApiKey ? service : supabase
  const phone = normalizePhone(parsed.data.phone)

  // Dedup por telefone só no caminho da API key: a extensão pode reenviar o
  // mesmo FSBO se voltares a extrair o mesmo anúncio. O formulário normal do
  // CRM mantém o comportamento anterior (sem dedup automático).
  if (usedApiKey && phone) {
    const { data: existing } = await db
      .from('leads')
      .select('id, full_name')
      .eq('team_id', teamId)
      .eq('phone', phone)
      .maybeSingle()
    if (existing) {
      return NextResponse.json({ ...existing, already_existed: true }, { status: 200 })
    }
  }

  const { data, error } = await db
    .from('leads')
    .insert({
      ...parsed.data,
      phone,
      team_id: teamId,
      assigned_to: assignedTo,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Create empty lead profile
  await db.from('lead_profiles').insert({ lead_id: data.id })

  return NextResponse.json(data, { status: 201 })
}
