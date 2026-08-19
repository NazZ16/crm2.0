// /api/leads/[id]/analyze-all — compila todo o historico de interacoes ja guardado
// (chamadas, whatsapp, notas, email) e corre o lead-agent sobre ele. Variante de
// /api/agents/leads que, em vez de receber texto colado, busca-o na BD. Logica de negocio
// em lib/lead-analysis.ts, partilhada com o cron semanal (lib/weekly-lead-analysis.ts).
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { analyzeLeadFullHistory } from '@/lib/lead-analysis'

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

  let result
  try {
    result = await analyzeLeadFullHistory(supabase, {
      leadId,
      teamId: member.team_id,
      triggerType: 'manual',
    })
  } catch (err) {
    console.error('[analyze-all] Error:', err)
    return NextResponse.json({ error: 'Erro no agente de análise' }, { status: 500 })
  }

  if (result.status === 'not_found') {
    return NextResponse.json({ error: 'Lead não encontrada' }, { status: 404 })
  }
  if (result.status === 'no_interactions') {
    return NextResponse.json(
      { error: 'Sem interações registadas para esta lead ainda.' },
      { status: 400 }
    )
  }

  return NextResponse.json({
    ...result.output,
    extraction_id: result.extractionId,
    run_id: result.runId,
  })
}
