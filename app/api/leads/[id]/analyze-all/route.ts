// /api/leads/[id]/analyze-all — compila todo o historico de interacoes ja guardado
// (chamadas, whatsapp, notas, email) e corre o lead-agent sobre ele. Variante de
// /api/agents/leads que, em vez de receber texto colado, busca-o na BD.
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { leadAgent } from '@/lib/agents/lead-agent'
import type { AgentFullOutput, LeadProfile } from '@/lib/types'

const MAX_CHARS = 12000

const OBJECTIVE =
  'Compilar todo o histórico de interações (chamadas, WhatsApp, notas) e atualizar o perfil ' +
  'completo de comprador/vendedor, com recomendações de próximos passos e rascunhos de follow-up.'

interface InteractionRow {
  type: string
  raw_text: string | null
  summary: string | null
  occurred_at: string
}

function buildConversationText(interactions: InteractionRow[]): string {
  const blocks = interactions
    .map((i) => {
      const content = i.raw_text ?? i.summary
      if (!content) return null
      const when = new Date(i.occurred_at).toLocaleString('pt-PT')
      return `[${i.type} — ${when}]\n${content}`
    })
    .filter((b): b is string => b !== null)

  const fullText = blocks.join('\n---\n')

  return fullText.length > MAX_CHARS
    ? fullText.slice(0, MAX_CHARS * 0.7) +
        '\n\n[...histórico resumido...]\n\n' +
        fullText.slice(-MAX_CHARS * 0.3)
    : fullText
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: leadId } = await params

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

  const { data: lead } = await supabase
    .from('leads')
    .select('id, full_name')
    .eq('id', leadId)
    .eq('team_id', member.team_id)
    .single()

  if (!lead) return NextResponse.json({ error: 'Lead não encontrada' }, { status: 404 })

  const { data: interactions } = await supabase
    .from('interactions')
    .select('type, raw_text, summary, occurred_at')
    .eq('lead_id', leadId)
    .eq('team_id', member.team_id)
    .order('occurred_at', { ascending: true })

  const conversationText = buildConversationText((interactions ?? []) as InteractionRow[])

  if (!conversationText) {
    return NextResponse.json(
      { error: 'Sem interações registadas para esta lead ainda.' },
      { status: 400 }
    )
  }

  const [profileRes, learningsRes] = await Promise.all([
    supabase.from('lead_profiles').select('*').eq('lead_id', leadId).single(),
    supabase
      .from('agent_learnings')
      .select('content')
      .eq('team_id', member.team_id)
      .order('confidence', { ascending: false })
      .limit(5),
  ])

  const existingProfile = profileRes.data as LeadProfile | null
  const agentLearnings = (learningsRes.data ?? []).map((l: { content: string }) => l.content)

  const { data: run } = await supabase
    .from('agent_runs')
    .insert({
      team_id: member.team_id,
      agent_type: 'lead',
      trigger_type: 'manual',
      lead_id: leadId,
      input_summary: `Análise de histórico completo (${(interactions ?? []).length} interações)`,
      status: 'running',
    })
    .select('id')
    .single()

  const startMs = Date.now()
  let output: AgentFullOutput

  try {
    output = await leadAgent.analyze({
      leadName: lead.full_name,
      conversationText,
      objective: OBJECTIVE,
      existingProfile: existingProfile ?? undefined,
      agentLearnings,
    })
  } catch (err) {
    if (run) {
      await supabase
        .from('agent_runs')
        .update({ status: 'failed', error: String(err), duration_ms: Date.now() - startMs })
        .eq('id', run.id)
    }
    console.error('[analyze-all] Error:', err)
    return NextResponse.json({ error: 'Erro no agente de análise' }, { status: 500 })
  }

  const durationMs = Date.now() - startMs
  const meta = (output as AgentFullOutput & { _meta?: { tokens?: number } })._meta
  delete (output as AgentFullOutput & { _meta?: unknown })._meta

  const { data: extraction } = await supabase
    .from('agent_extractions')
    .insert({
      team_id: member.team_id,
      lead_id: leadId,
      upload_id: null,
      run_id: run?.id ?? null,
      extracted_json: output.lead_updates,
      recommendations_json: output.recommendations,
      drafts_json: output.drafts,
    })
    .select('id')
    .single()

  if (run) {
    await supabase
      .from('agent_runs')
      .update({
        status: 'done',
        output_json: output,
        tokens_used: meta?.tokens ?? null,
        duration_ms: durationMs,
      })
      .eq('id', run.id)
  }

  return NextResponse.json({
    ...output,
    extraction_id: extraction?.id,
    run_id: run?.id,
  })
}
