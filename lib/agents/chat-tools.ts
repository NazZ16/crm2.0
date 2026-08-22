// Tools de leitura para o chat-agent. Cada tool corre com o client Supabase
// autenticado da sessão (RLS aplica-se via auth_team_id() — não precisa de
// filtrar team_id manualmente).

import type { SupabaseClient } from '@supabase/supabase-js'
import type Anthropic from '@anthropic-ai/sdk'

export const CHAT_TOOLS: Anthropic.Tool[] = [
  {
    name: 'search_leads',
    description: 'Procura leads por nome/telefone/email e/ou filtros de status e tipo. Usa para perguntas sobre leads em geral (quantos, quais, quentes, frias, etc).',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Texto livre para procurar em nome, telefone ou email' },
        status: {
          type: 'string',
          enum: ['new', 'qualified', 'meeting', 'active', 'cpcv', 'escriturado', 'won', 'lost'],
        },
        lead_type: { type: 'string', enum: ['buyer', 'seller', 'both', 'unknown'] },
        limit: { type: 'number', description: 'Máximo de resultados, default 15' },
      },
    },
  },
  {
    name: 'get_lead_detail',
    description: 'Devolve o detalhe completo de um lead (perfil, interações recentes, tarefas) dado o seu id. Usa depois de encontrar o lead com search_leads.',
    input_schema: {
      type: 'object',
      properties: {
        lead_id: { type: 'string' },
      },
      required: ['lead_id'],
    },
  },
  {
    name: 'search_listings',
    description: 'Procura imóveis (listings) por localização, tipo, preço, tipologia, etc. Usa para perguntas sobre a carteira de imóveis.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Texto livre para procurar em título/referência/zona' },
        municipality: { type: 'string' },
        property_type: { type: 'string', enum: ['apartamento', 'moradia', 'terreno', 'comercial', 'garagem', 'outro'] },
        business_type: { type: 'string', enum: ['venda', 'arrendamento'] },
        status: { type: 'string', enum: ['active', 'reserved', 'sold', 'withdrawn'] },
        price_min: { type: 'number' },
        price_max: { type: 'number' },
        limit: { type: 'number', description: 'Máximo de resultados, default 15' },
      },
    },
  },
  {
    name: 'search_tasks',
    description: 'Procura tarefas por status, prioridade, prazo ou lead associado. Usa para perguntas sobre o que falta fazer, tarefas em atraso, etc.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['open', 'done'] },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
        due_before: { type: 'string', description: 'ISO date — só tarefas com due_at <= esta data (usa para "em atraso" com a data de hoje)' },
        lead_id: { type: 'string' },
        limit: { type: 'number', description: 'Máximo de resultados, default 20' },
      },
    },
  },
]

export async function runChatTool(
  supabase: SupabaseClient,
  name: string,
  input: Record<string, unknown>
): Promise<unknown> {
  switch (name) {
    case 'search_leads':
      return searchLeads(supabase, input)
    case 'get_lead_detail':
      return getLeadDetail(supabase, input)
    case 'search_listings':
      return searchListings(supabase, input)
    case 'search_tasks':
      return searchTasks(supabase, input)
    default:
      return { error: `Tool desconhecida: ${name}` }
  }
}

async function searchLeads(supabase: SupabaseClient, input: Record<string, unknown>) {
  const query = input.query as string | undefined
  const status = input.status as string | undefined
  const leadType = input.lead_type as string | undefined
  const limit = Math.min((input.limit as number) || 15, 50)

  let q = supabase
    .from('leads')
    .select('id, full_name, phone, email, status, lead_type, score, urgency, last_contact_at, next_action_at')
    .order('urgency', { ascending: false })
    .limit(limit)

  if (query) q = q.or(`full_name.ilike.%${query}%,phone.ilike.%${query}%,email.ilike.%${query}%`)
  if (status) q = q.eq('status', status)
  if (leadType) q = q.eq('lead_type', leadType)

  const { data, error } = await q
  if (error) return { error: error.message }
  return { count: data?.length ?? 0, leads: data ?? [] }
}

async function getLeadDetail(supabase: SupabaseClient, input: Record<string, unknown>) {
  const leadId = input.lead_id as string
  if (!leadId) return { error: 'lead_id em falta' }

  const [leadRes, profileRes, interactionsRes, tasksRes] = await Promise.all([
    supabase.from('leads').select('*').eq('id', leadId).maybeSingle(),
    supabase.from('lead_profiles').select('summary, home_preferences, financial_profile, confidence_score').eq('lead_id', leadId).maybeSingle(),
    supabase.from('interactions').select('type, summary, occurred_at, direction').eq('lead_id', leadId).order('occurred_at', { ascending: false }).limit(10),
    supabase.from('tasks').select('id, title, status, priority, due_at').eq('lead_id', leadId).order('due_at', { ascending: true }),
  ])

  if (leadRes.error) return { error: leadRes.error.message }
  if (!leadRes.data) return { error: 'Lead não encontrado' }

  return {
    lead: leadRes.data,
    profile: profileRes.data ?? null,
    recent_interactions: interactionsRes.data ?? [],
    tasks: tasksRes.data ?? [],
  }
}

async function searchListings(supabase: SupabaseClient, input: Record<string, unknown>) {
  const query = input.query as string | undefined
  const municipality = input.municipality as string | undefined
  const propertyType = input.property_type as string | undefined
  const businessType = input.business_type as string | undefined
  const status = (input.status as string | undefined) ?? 'active'
  const priceMin = input.price_min as number | undefined
  const priceMax = input.price_max as number | undefined
  const limit = Math.min((input.limit as number) || 15, 50)

  let q = supabase
    .from('listings')
    .select('id, reference, title, business_type, property_type, typology, price, municipality, zone, bedrooms, status')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (query) q = q.or(`title.ilike.%${query}%,reference.ilike.%${query}%,zone.ilike.%${query}%`)
  if (municipality) q = q.ilike('municipality', `%${municipality}%`)
  if (propertyType) q = q.eq('property_type', propertyType)
  if (businessType) q = q.eq('business_type', businessType)
  if (status) q = q.eq('status', status)
  if (priceMin != null) q = q.gte('price', priceMin)
  if (priceMax != null) q = q.lte('price', priceMax)

  const { data, error } = await q
  if (error) return { error: error.message }
  return { count: data?.length ?? 0, listings: data ?? [] }
}

async function searchTasks(supabase: SupabaseClient, input: Record<string, unknown>) {
  const status = input.status as string | undefined
  const priority = input.priority as string | undefined
  const dueBefore = input.due_before as string | undefined
  const leadId = input.lead_id as string | undefined
  const limit = Math.min((input.limit as number) || 20, 50)

  let q = supabase
    .from('tasks')
    .select('id, title, description, status, priority, due_at, lead_id, leads(full_name)')
    .order('due_at', { ascending: true })
    .limit(limit)

  if (status) q = q.eq('status', status)
  if (priority) q = q.eq('priority', priority)
  if (dueBefore) q = q.lte('due_at', dueBefore)
  if (leadId) q = q.eq('lead_id', leadId)

  const { data, error } = await q
  if (error) return { error: error.message }

  const enriched = (data ?? []).map((t) => {
    const lead = Array.isArray(t.leads) ? t.leads[0] : t.leads
    return { ...t, leads: undefined, lead_name: (lead as { full_name?: string } | null)?.full_name ?? null }
  })

  return { count: enriched.length, tasks: enriched }
}
