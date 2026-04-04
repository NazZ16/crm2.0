// app/api/agents/matching/route.ts
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { scoreAllInvestors, DEFAULT_SCORE_THRESHOLD, DEFAULT_PITCH_THRESHOLD } from '@/lib/matching-engine'
import { generatePitches } from '@/lib/agents/matching-agent'
import type { Investor, Opportunity } from '@/lib/types'

const schema = z.object({ opportunity_id: z.string().uuid() })

export async function POST(request: Request) {
  const internalSecret = request.headers.get('X-Internal-Secret')
  const secret = process.env.INTERNAL_SECRET
  const isInternalCall = !!(internalSecret && secret && secret.length >= 16 && internalSecret === secret)

  const supabase = await createClient()
  let teamId: string | null = null

  if (!isInternalCall) {
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
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const { opportunity_id } = parsed.data

  // Fetch opportunity (for internal calls we don't have teamId yet — get it from the opportunity)
  const oppQuery = supabase
    .from('opportunities')
    .select('*')
    .eq('id', opportunity_id)

  if (teamId) oppQuery.eq('team_id', teamId)

  const { data: opp } = await oppQuery.single()
  if (!opp) return NextResponse.json({ error: 'Oportunidade não encontrada' }, { status: 404 })

  if (!teamId) teamId = opp.team_id

  // LAYER 1: SQL hard filter — budget range only (zone/typology filtered in TS — arrays need TS logic)
  const price = opp.negotiated_price ?? opp.asking_price
  const { data: investors } = await supabase
    .from('investors')
    .select('*')
    .eq('team_id', teamId)
    .eq('status', 'active')
    .or(`budget_min.is.null,budget_min.lte.${price}`)
    .or(`budget_max.is.null,budget_max.gte.${price}`)

  if (!investors || investors.length === 0) {
    return NextResponse.json({ matches_created: 0, message: 'Nenhum investidor dentro do budget' })
  }

  // LAYER 2: TypeScript scoring (free)
  const SCORE_THRESHOLD = DEFAULT_SCORE_THRESHOLD
  const PITCH_THRESHOLD = DEFAULT_PITCH_THRESHOLD
  const scored = scoreAllInvestors(investors as Investor[], opp as Opportunity, SCORE_THRESHOLD)

  if (scored.length === 0) {
    return NextResponse.json({ matches_created: 0, message: 'Nenhum investidor compatível' })
  }

  // LAYER 3: Haiku batch — only for score ≥ 65
  const topMatches = scored.filter((m) => m.score >= PITCH_THRESHOLD)
  const pitches = topMatches.length > 0
    ? await generatePitches(topMatches, investors as Investor[], opp as Opportunity)
    : []
  const pitchMap = new Map(pitches.map((p) => [p.investor_id, p.pitch_draft]))

  // Upsert investor_matches
  const matchRows = scored.map((m) => ({
    team_id: teamId as string,
    investor_id: m.investor_id,
    opportunity_id,
    match_score: m.score,
    match_reasons: m.reasons,
    ai_analysis: null,
    pitch_draft: pitchMap.get(m.investor_id) ?? null,
    status: 'suggested' as const,
  }))

  const { data: inserted, error: insertError } = await supabase
    .from('investor_matches')
    .upsert(matchRows, { onConflict: 'investor_id,opportunity_id', ignoreDuplicates: false })
    .select('id')

  if (insertError) {
    console.error('[matching] Erro ao inserir matches:', insertError)
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  const matchCount = inserted?.length ?? 0

  if (matchCount > 0) {
    await supabase.from('notifications').insert({
      team_id: teamId,
      type: 'agent_complete',
      title: 'Novos matches encontrados',
      body: `"${opp.title}" tem ${matchCount} investidor${matchCount > 1 ? 'es' : ''} compatível${matchCount > 1 ? 'is' : ''} (score ≥ ${SCORE_THRESHOLD})`,
      link: `/dashboard/matching`,
      user_id: null,
    })
  }

  return NextResponse.json({
    matches_created: matchCount,
    investors_evaluated: investors.length,
    investors_after_ts_filter: scored.length,
    pitches_generated: pitches.length,
  })
}
