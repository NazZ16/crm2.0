import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { leadAgent } from '@/lib/agents/lead-agent'
import type { AgentFullOutput, LeadProfile } from '@/lib/types'

const analyzeSchema = z.object({
  lead_id: z.string().uuid(),
  conversation_text: z.string().min(10).max(50000),
  objective: z.string().min(1).max(100),
  upload_id: z.string().uuid().optional(),
})

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
  const parsed = analyzeSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Dados inválidos', details: parsed.error.flatten() }, { status: 400 })
  }

  const { lead_id, conversation_text, objective, upload_id } = parsed.data

  // Verify lead belongs to team
  const { data: lead } = await supabase
    .from('leads')
    .select('id, full_name')
    .eq('id', lead_id)
    .eq('team_id', member.team_id)
    .single()

  if (!lead) return NextResponse.json({ error: 'Lead não encontrada' }, { status: 404 })

  // Fetch existing profile + recent learnings
  const [profileRes, learningsRes] = await Promise.all([
    supabase
      .from('lead_profiles')
      .select('*')
      .eq('lead_id', lead_id)
      .single(),
    supabase
      .from('agent_learnings')
      .select('content')
      .eq('team_id', member.team_id)
      .order('confidence', { ascending: false })
      .limit(5),
  ])

  const existingProfile = profileRes.data as LeadProfile | null
  const agentLearnings = (learningsRes.data ?? []).map((l: { content: string }) => l.content)

  // Create agent_run record
  const { data: run } = await supabase
    .from('agent_runs')
    .insert({
      team_id: member.team_id,
      agent_type: 'lead',
      trigger_type: 'manual',
      lead_id,
      input_summary: `Análise de conversa: ${objective}`,
      status: 'running',
    })
    .select('id')
    .single()

  const startMs = Date.now()
  let output: AgentFullOutput

  try {
    output = await leadAgent.analyze({
      leadName: lead.full_name,
      conversationText: conversation_text,
      objective,
      existingProfile: existingProfile ?? undefined,
      agentLearnings,
    })
  } catch (err) {
    // Mark run as failed
    if (run) {
      await supabase
        .from('agent_runs')
        .update({ status: 'failed', error: String(err), duration_ms: Date.now() - startMs })
        .eq('id', run.id)
    }
    console.error('[LeadAgent] Error:', err)
    return NextResponse.json({ error: 'Erro no agente de análise' }, { status: 500 })
  }

  const durationMs = Date.now() - startMs
  const meta = (output as AgentFullOutput & { _meta?: { tokens?: number } })._meta
  delete (output as AgentFullOutput & { _meta?: unknown })._meta

  // Save agent_extraction
  const { data: extraction } = await supabase
    .from('agent_extractions')
    .insert({
      team_id: member.team_id,
      lead_id,
      upload_id: upload_id ?? null,
      run_id: run?.id ?? null,
      extracted_json: output.lead_updates,
      recommendations_json: output.recommendations,
      drafts_json: output.drafts,
    })
    .select('id')
    .single()

  // Update agent_run with results
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

  // Update lead score, urgency, last_contact_at
  const now = new Date().toISOString()
  await supabase
    .from('leads')
    .update({
      score: output.lead_updates.score,
      urgency: output.lead_updates.urgency,
      last_contact_at: now,
    })
    .eq('id', lead_id)

  // Merge extracted profile into lead_profiles (deep merge — only overwrite non-null new values)
  function mergeField<T>(existing: T | null | undefined, updated: Partial<T> | null | undefined): T | null {
    if (!updated) return existing ?? null
    if (!existing) return updated as T
    const result = { ...existing } as Record<string, unknown>
    for (const [k, v] of Object.entries(updated as Record<string, unknown>)) {
      if (v !== null && v !== undefined) {
        if (Array.isArray(v) && v.length > 0) result[k] = v
        else if (!Array.isArray(v)) result[k] = v
      }
    }
    return result as T
  }

  const ex = output.lead_updates
  const profileUpsert = {
    lead_id,
    home_preferences: mergeField(existingProfile?.home_preferences, ex.home_preferences),
    financial_profile: mergeField(existingProfile?.financial_profile, ex.financial_profile),
    personality_traits: mergeField(existingProfile?.personality_traits, ex.personality_traits),
    family_context: mergeField(existingProfile?.family_context, ex.family_context),
    fears_objections: mergeField(existingProfile?.fears_objections, ex.fears_objections),
    process_preferences: mergeField(existingProfile?.process_preferences, ex.process_preferences),
    summary: ex.summary || existingProfile?.summary || null,
    confidence_score: ex.confidence_score,
    updated_at: now,
  }

  await supabase
    .from('lead_profiles')
    .upsert(profileUpsert, { onConflict: 'lead_id' })

  // Create interaction record
  await supabase.from('interactions').insert({
    lead_id,
    team_id: member.team_id,
    type: 'note',
    raw_text: conversation_text.slice(0, 10000),
    summary: output.lead_updates.summary,
    occurred_at: now,
  })

  // Create tasks from next_best_actions
  const actions = output.recommendations.next_best_actions ?? []
  if (actions.length > 0) {
    const priorityMap: Record<string, 'low' | 'medium' | 'high' | 'urgent'> = {
      high: 'high',
      medium: 'medium',
      low: 'low',
    }

    const tasksToCreate = actions.slice(0, 3).map((action) => ({
      lead_id,
      team_id: member.team_id,
      title: action.title,
      description: action.description,
      priority: priorityMap[action.priority] ?? 'medium',
      created_by: 'agent' as const,
      due_at: action.due_in_hours
        ? new Date(Date.now() + action.due_in_hours * 60 * 60 * 1000).toISOString()
        : null,
    }))

    await supabase.from('tasks').insert(tasksToCreate)
  }

  return NextResponse.json({
    ...output,
    extraction_id: extraction?.id,
    run_id: run?.id,
  })
}
