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
      id, full_name, status, score, urgency, lead_type, last_contact_at, created_at, notes,
      lead_profiles(summary, home_preferences, financial_profile, personality_traits, family_context, fears_objections, process_preferences, seller_profile),
      interactions(summary, occurred_at)
    `)
    .eq('id', parsed.data.lead_id)
    .eq('team_id', member.team_id)
    .order('occurred_at', { foreignTable: 'interactions', ascending: false })
    .limit(3, { foreignTable: 'interactions' })
    .single()

  if (!lead) return NextResponse.json({ error: 'Lead nao encontrada' }, { status: 404 })

  const ref = lead.last_contact_at ?? lead.created_at
  const daysIdle = Math.floor((Date.now() - new Date(ref as string).getTime()) / (24 * 60 * 60 * 1000))

  const profile = Array.isArray(lead.lead_profiles) ? lead.lead_profiles[0] : lead.lead_profiles
  const interactionsArr = Array.isArray(lead.interactions) ? lead.interactions : (lead.interactions ? [lead.interactions] : [])

  // Junta varias notas curtas descartando valores vazios
  function joinNote(parts: Array<string | null | undefined | false>): string | null {
    const filtered = parts.filter((p): p is string => Boolean(p))
    return filtered.length ? filtered.join('; ') : null
  }

  const interactionsNote = joinNote(
    interactionsArr.map((i) => (i as { summary?: string | null }).summary)
  )

  // Pequenos resumos para passar ao agente — usa o maximo de informacao do perfil da lead
  const home = profile?.home_preferences as { zonas?: string[]; tipologia?: string | null } | null | undefined
  const homeNote = home && (home.zonas?.length || home.tipologia)
    ? [home.tipologia, home.zonas?.join(', ')].filter(Boolean).join(' em ')
    : null

  const financial = profile?.financial_profile as {
    orcamento_max?: number | null
    necessita_financiamento?: boolean | null
    notas?: string | null
  } | null | undefined
  const financialNote = joinNote([
    financial?.orcamento_max ? `orcamento ate ${financial.orcamento_max}€` : null,
    financial?.necessita_financiamento === true ? 'precisa de financiamento' : null,
    financial?.notas,
  ])

  const personality = profile?.personality_traits as {
    tipo?: string | null
    comunicacao?: string | null
    ritmo?: string | null
    notas?: string | null
  } | null | undefined
  const personalityNote = joinNote([personality?.tipo, personality?.comunicacao, personality?.ritmo, personality?.notas])

  const family = profile?.family_context as {
    num_pessoas?: number | null
    filhos?: boolean | null
    prazo_mudanca?: string | null
    situacao_atual?: string | null
    notas?: string | null
  } | null | undefined
  const familyNote = joinNote([
    family?.filhos === true ? 'tem filhos' : null,
    family?.num_pessoas ? `${family.num_pessoas} pessoas no agregado` : null,
    family?.prazo_mudanca ? `prazo de mudanca: ${family.prazo_mudanca}` : null,
    family?.situacao_atual,
    family?.notas,
  ])

  const fears = profile?.fears_objections as { lista?: string[]; notas?: string | null } | null | undefined
  const fearsNote = joinNote([fears?.lista?.length ? fears.lista.join(', ') : null, fears?.notas])

  const processPrefs = profile?.process_preferences as {
    canal_preferido?: string | null
    frequencia_updates?: string | null
    disponibilidade?: string | null
    notas?: string | null
  } | null | undefined
  const processNote = joinNote([
    processPrefs?.canal_preferido,
    processPrefs?.frequencia_updates,
    processPrefs?.disponibilidade,
    processPrefs?.notas,
  ])

  const sellerProfile = profile?.seller_profile as {
    imovel?: { tipologia?: string | null; freguesia?: string | null; concelho?: string | null } | null
    historico?: { ja_tentou_vender?: boolean | null; tempo_no_mercado_meses?: number | null; motivo_nao_vendeu?: string | null } | null
    objectivo?: { preco_pedido?: number | null; prazo_venda_meses?: number | null; motivacao?: string | null } | null
  } | null | undefined
  const sellerImovel = sellerProfile?.imovel
  const sellerNote = sellerImovel
    ? [sellerImovel.tipologia, sellerImovel.freguesia ?? sellerImovel.concelho].filter(Boolean).join(' em ')
    : null

  const sellerObjectivo = sellerProfile?.objectivo
  const sellerObjectivoNote = joinNote([
    sellerObjectivo?.preco_pedido ? `preco pedido ${sellerObjectivo.preco_pedido}€` : null,
    sellerObjectivo?.prazo_venda_meses ? `prazo desejado ${sellerObjectivo.prazo_venda_meses} meses` : null,
    sellerObjectivo?.motivacao,
  ])

  const sellerHistorico = sellerProfile?.historico
  const sellerHistoricoNote = joinNote([
    sellerHistorico?.ja_tentou_vender === true && sellerHistorico.tempo_no_mercado_meses
      ? `ja no mercado ha ${sellerHistorico.tempo_no_mercado_meses} meses`
      : null,
    sellerHistorico?.motivo_nao_vendeu,
  ])

  try {
    const result = await reEngagementAgent.generate({
      leadName: lead.full_name as string,
      leadType: ((lead.lead_type as LeadType | null | undefined) ?? 'unknown') as LeadType,
      status: lead.status as LeadStatus,
      daysIdle,
      score: (lead.score as number) ?? 0,
      urgency: (lead.urgency as number) ?? 1,
      summary: (profile?.summary as string | null) ?? null,
      lastInteractionSummary: interactionsNote,
      homePreferencesNote: homeNote,
      financialProfileNote: financialNote,
      familyContextNote: familyNote,
      personalityNote,
      fearsObjectionsNote: fearsNote,
      processPreferencesNote: processNote,
      sellerImovelNote: sellerNote,
      sellerObjectivoNote,
      sellerHistoricoNote,
      generalNotes: (lead.notes as string | null) ?? null,
      idea: parsed.data.idea || null,
    })

    return NextResponse.json({ body: result.body, tokens: result.tokensUsed })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'erro desconhecido'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
