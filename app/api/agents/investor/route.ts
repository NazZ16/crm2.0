import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { InvestorAgent } from '@/lib/agents/investor-agent'

const schema = z.object({
  opportunity_id: z.string().uuid(),
})

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: member } = await supabase
    .from('team_members')
    .select('team_id')
    .eq('user_id', user.id)
    .single()

  if (!member) return NextResponse.json({ error: 'Equipa não encontrada' }, { status: 403 })

  const body = await request.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const { opportunity_id } = parsed.data
  const teamId = member.team_id
  const startTime = Date.now()

  // Log run start
  const { data: run } = await supabase
    .from('agent_runs')
    .insert({
      team_id: teamId,
      agent_type: 'investor',
      trigger_type: 'manual',
      lead_id: null,
      input_summary: `Matching investidores para oportunidade ${opportunity_id}`,
      status: 'running',
    })
    .select('id')
    .single()

  try {
    // Buscar oportunidade
    const { data: opportunity, error: oppError } = await supabase
      .from('opportunities')
      .select('*')
      .eq('id', opportunity_id)
      .eq('team_id', teamId)
      .single()

    if (oppError || !opportunity) {
      return NextResponse.json({ error: 'Oportunidade não encontrada' }, { status: 404 })
    }

    // Buscar investidores ativos
    const { data: investors, error: invError } = await supabase
      .from('investors')
      .select('*')
      .eq('team_id', teamId)
      .eq('status', 'active')

    if (invError) throw new Error(invError.message)
    if (!investors || investors.length === 0) {
      return NextResponse.json({ error: 'Sem investidores ativos na base de dados' }, { status: 400 })
    }

    // Correr o agente
    const agent = new InvestorAgent()
    const { output, tokensUsed } = await agent.run(opportunity, investors)

    // Guardar matches na DB (upsert — permite re-correr o agente)
    if (output.matches.length > 0) {
      const matchRows = output.matches.map((m) => ({
        team_id: teamId,
        investor_id: m.investor_id,
        opportunity_id,
        match_score: m.score,
        match_reasons: m.reasons,
        ai_analysis: m.reasons.map((r) => r.reason).join(' | '),
        pitch_draft: m.pitch_draft,
        status: 'suggested' as const,
      }))

      await supabase
        .from('investor_matches')
        .upsert(matchRows, { onConflict: 'investor_id,opportunity_id', ignoreDuplicates: false })
    }

    // Actualizar run com sucesso
    await supabase
      .from('agent_runs')
      .update({
        status: 'done',
        output_json: output,
        tokens_used: tokensUsed,
        duration_ms: Date.now() - startTime,
      })
      .eq('id', run?.id)

    return NextResponse.json({
      matches_count: output.matches.length,
      best_match_id: output.best_match_id,
      opportunity_summary: output.opportunity_summary,
      analysis_notes: output.analysis_notes,
      matches: output.matches,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido'

    await supabase
      .from('agent_runs')
      .update({
        status: 'failed',
        error: message,
        duration_ms: Date.now() - startTime,
      })
      .eq('id', run?.id)

    return NextResponse.json({ error: message }, { status: 500 })
  }
}
