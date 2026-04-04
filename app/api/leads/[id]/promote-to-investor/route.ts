import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const schema = z.object({
  budget_min: z.number().int().positive().optional().nullable(),
  budget_max: z.number().int().positive().optional().nullable(),
  preferred_zones: z.array(z.string()).default([]),
  preferred_typologies: z.array(z.string()).default([]),
  investment_type: z.array(z.string()).default([]),
  min_yield: z.number().min(0).max(100).optional().nullable(),
  risk_level: z.enum(['conservative', 'moderate', 'aggressive']).default('moderate'),
  investment_horizon: z.enum(['short', 'medium', 'long']).default('medium'),
  needs_financing: z.boolean().default(false),
  max_renovation: z.enum(['none', 'light', 'medium', 'full']).default('light'),
  notes: z.string().max(2000).optional().nullable(),
}).refine(
  (data) => {
    if (data.budget_min != null && data.budget_max != null) {
      return data.budget_min <= data.budget_max
    }
    return true
  },
  { message: 'budget_min não pode ser maior que budget_max', path: ['budget_min'] }
)

interface Props {
  params: Promise<{ id: string }>
}

export async function POST(request: Request, { params }: Props) {
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
    .select('id, full_name, email, phone')
    .eq('id', leadId)
    .eq('team_id', member.team_id)
    .single()

  if (!lead) return NextResponse.json({ error: 'Lead não encontrada' }, { status: 404 })

  const { data: existing } = await supabase
    .from('investors')
    .select('id')
    .eq('lead_id', leadId)
    .eq('team_id', member.team_id)
    .maybeSingle()

  if (existing) {
    return NextResponse.json({ error: 'Lead já tem investidor associado', investor_id: existing.id }, { status: 409 })
  }

  const body = await request.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const { data: investor, error } = await supabase
    .from('investors')
    .insert({
      team_id: member.team_id,
      lead_id: leadId,
      name: lead.full_name,
      email: lead.email,
      phone: lead.phone,
      ...parsed.data,
      status: 'active',
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(investor, { status: 201 })
}
