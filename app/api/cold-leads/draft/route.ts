// /api/cold-leads/draft
// POST { lead_id } → gera draft de re-engagement via Haiku.
// Devolve { body } sem persistir nada na DB.

import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { reEngagementAgent } from '@/lib/agents/re-engagement-agent'
import type { LeadStatus, LeadType } from '@/lib/types'

const schema = z.object({
  lead_id: z.string().uuid(),
  idea: z.string().trim().max(500).optional(),
})

export const maxDuration = 30

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })

  const { data: member } = await supabase
    .from('team_members')
    .select('team_id, role')
    .eq('user_id', user.id)
    .single()
  if (!member || member.role === 'viewer') {
    return NextResponse.json({ error: 'Sem permissao' }, { status: 403 })
  }

  const body = await request.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Dados invalidos' }, { status: 400 })
  }

  const { data: lead } = await supabase
    .from('leads')
    .select(`
      id, full_name, status, score, urgency, lead_type, last_contact_at, created_at,
      lead_profiles(summary, home_preferences, seller_profile),
      interactions(summary, occurred_at)
    `)
    .eq('id', parsed.data.lead_id)
    .eq('team_id', member.team_id)
    .order('occurred_at', { foreignTable: 'interactions', ascending: false })
    .limit(1, { foreignTable: 'interactions' })
    .single()

  if (!lead) return NextResponse.json({ error: 'Lead nao encontrada' }, { status: 404 })

  const ref = lead.last_contact_at ?? lead.created_at
  const daysIdle = Math.floor((Date.now() - new Date(ref as string).getTime()) / (24 * 60 * 60 * 1000))

  const profile = Array.isArray(lead.lead_profiles) ? lead.lead_profiles[0] : lead.lead_profiles
  const lastInter = Array.isArray(lead.interactions) ? lead.interactions[0] : lead.interactions

  // Pequenos resumos para passar ao agente
  const home = profile?.home_preferences as { zonas?: string[]; tipologia?: string | null } | null | undefined
  const homeNote = home && (home.zonas?.length || home.tipologia)
    ? [home.tipologia, home.zonas?.join(', ')].filter(Boolean).join(' em ')
    : null

  const sellerProfile = profile?.seller_profile as {
    imovel?: { tipologia?: string | null; freguesia?: string | null; concelho?: string | null } | null
    objectivo?: { preco_pedido?: number | null } | null
  } | null | undefined
  const sellerImovel = sellerProfile?.imovel
  const sellerNote = sellerImovel
    ? [sellerImovel.tipologia, sellerImovel.freguesia ?? sellerImovel.concelho].filter(Boolean).join(' em ')
    : null

  try {
    const result = await reEngagementAgent.generate({
      leadName: lead.full_name as string,
      leadType: ((lead.lead_type as LeadType | null | undefined) ?? 'unknown') as LeadType,
      status: lead.status as LeadStatus,
      daysIdle,
      score: (lead.score as number) ?? 0,
      urgency: (lead.urgency as number) ?? 1,
      summary: (profile?.summary as string | null) ?? null,
      lastInteractionSummary: (lastInter?.summary as string | null) ?? null,
      homePreferencesNote: homeNote,
      sellerImovelNote: sellerNote,
      idea: parsed.data.idea || null,
    })

    return NextResponse.json({ body: result.body, tokens: result.tokensUsed })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'erro desconhecido'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
