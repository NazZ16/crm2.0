import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const upsertMetricSchema = z.object({
  campaign_id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato YYYY-MM-DD'),
  spend: z.number().min(0).default(0),
  impressions: z.number().int().min(0).default(0),
  clicks: z.number().int().min(0).default(0),
  leads_count: z.number().int().min(0).default(0),
  conversions: z.number().int().min(0).default(0),
})

// GET /api/campaign-metrics?campaign_id=...&from=YYYY-MM-DD&to=YYYY-MM-DD
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: member } = await supabase
    .from('team_members')
    .select('team_id')
    .eq('user_id', user.id)
    .single()

  if (!member) return NextResponse.json({ error: 'Equipa não encontrada' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const campaignId = searchParams.get('campaign_id')
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  let query = supabase
    .from('campaign_metrics')
    .select('*')
    .eq('team_id', member.team_id)
    .order('date', { ascending: false })

  if (campaignId) query = query.eq('campaign_id', campaignId)
  if (from) query = query.gte('date', from)
  if (to) query = query.lte('date', to)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data ?? [])
}

// POST /api/campaign-metrics — upsert metrics for a campaign/date
export async function POST(request: Request) {
  const supabase = await createClient()
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

  const body = await request.json()
  const parsed = upsertMetricSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Dados inválidos', details: parsed.error.flatten() }, { status: 400 })
  }

  // Verify the campaign belongs to this team
  const { data: campaign } = await supabase
    .from('campaigns')
    .select('id')
    .eq('id', parsed.data.campaign_id)
    .eq('team_id', member.team_id)
    .single()

  if (!campaign) {
    return NextResponse.json({ error: 'Campanha não encontrada' }, { status: 404 })
  }

  // Calculate CPL
  const cpl = parsed.data.leads_count > 0
    ? parsed.data.spend / parsed.data.leads_count
    : null

  const { data, error } = await supabase
    .from('campaign_metrics')
    .upsert(
      {
        ...parsed.data,
        team_id: member.team_id,
        cpl,
      },
      { onConflict: 'campaign_id,date' }
    )
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data, { status: 201 })
}
