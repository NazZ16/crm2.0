import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse, after } from 'next/server'
import { z } from 'zod'
import { buildLeadPreferenceEmbeddingText, regenerateLeadProfileEmbedding } from '@/lib/embeddings'
import type { HomePreferences, FinancialProfile } from '@/lib/types'

// Edição manual do perfil de compra da lead (home_preferences / financial_profile).
// Complementa a extração automática por IA (lib/apply-extraction.ts) — aqui os
// valores enviados substituem sempre o campo correspondente (incluindo null,
// para permitir "limpar" um campo), ao contrário do merge da IA que ignora
// null para não apagar dados já confirmados por chamadas anteriores.
const updateProfileSchema = z.object({
  home_preferences: z
    .object({
      zonas: z.array(z.string()).optional(),
      tipologia: z.string().nullable().optional(),
      tipo_negocio: z.enum(['venda', 'arrendamento']).nullable().optional(),
      area_min: z.number().nonnegative().nullable().optional(),
      area_max: z.number().nonnegative().nullable().optional(),
      garagem: z.boolean().nullable().optional(),
      elevador: z.boolean().nullable().optional(),
    })
    .optional(),
  financial_profile: z
    .object({
      orcamento_max: z.number().nonnegative().nullable().optional(),
    })
    .optional(),
})

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: member } = await supabase
    .from('team_members')
    .select('team_id, role')
    .eq('user_id', user.id)
    .single()

  if (!member) return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
  if (member.role === 'viewer') return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })

  const { data: lead } = await supabase
    .from('leads')
    .select('id, notes')
    .eq('id', id)
    .eq('team_id', member.team_id)
    .single()

  if (!lead) return NextResponse.json({ error: 'Lead não encontrada' }, { status: 404 })

  const body = await request.json()
  const parsed = updateProfileSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Dados inválidos', details: parsed.error.flatten() }, { status: 400 })
  }

  const svc = createServiceClient()
  const { data: existingProfile } = await svc
    .from('lead_profiles')
    .select('home_preferences, financial_profile')
    .eq('lead_id', id)
    .maybeSingle()

  const mergedHomePreferences = parsed.data.home_preferences
    ? ({ ...(existingProfile?.home_preferences as HomePreferences | null), ...parsed.data.home_preferences } as HomePreferences)
    : (existingProfile?.home_preferences as HomePreferences | null) ?? null

  const mergedFinancialProfile = parsed.data.financial_profile
    ? ({ ...(existingProfile?.financial_profile as FinancialProfile | null), ...parsed.data.financial_profile } as FinancialProfile)
    : (existingProfile?.financial_profile as FinancialProfile | null) ?? null

  const { data, error } = await svc
    .from('lead_profiles')
    .upsert(
      {
        lead_id: id,
        home_preferences: mergedHomePreferences,
        financial_profile: mergedFinancialProfile,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'lead_id' }
    )
    .select('home_preferences, financial_profile')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (parsed.data.home_preferences) {
    after(
      regenerateLeadProfileEmbedding(
        svc,
        id,
        buildLeadPreferenceEmbeddingText(mergedHomePreferences, (lead.notes as string | null) ?? null)
      ).catch((err) => console.warn('[lead-profile] regenerate embedding', id, err))
    )
  }

  return NextResponse.json(data)
}
