// ─── Enums ────────────────────────────────────────────────────────────────────

export type LeadStatus = 'new' | 'qualified' | 'meeting' | 'active' | 'won' | 'lost'
export type InteractionType = 'call' | 'whatsapp' | 'email' | 'meeting' | 'note' | 'audio'
export type TaskStatus = 'open' | 'done'
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent'
export type TeamRole = 'admin' | 'agent' | 'viewer'
export type AdPlatform = 'meta' | 'google' | 'tiktok' | 'organic' | 'other'
export type AgentType = 'lead' | 'followup' | 'coach' | 'marketing' | 'investor'
export type AgentRunStatus = 'running' | 'done' | 'failed'
export type NotificationType = 'agent_complete' | 'cold_lead' | 'task_due' | 'tip' | 'info'

// ─── Database Models ───────────────────────────────────────────────────────────

export interface Team {
  id: string
  name: string
  slug: string
  plan: 'free' | 'pro' | 'enterprise'
  created_at: string
}

export interface TeamMember {
  id: string
  team_id: string
  user_id: string
  role: TeamRole
  joined_at: string
  // joins
  user?: {
    email: string
    user_metadata?: { full_name?: string; avatar_url?: string }
  }
}

export interface Lead {
  id: string
  team_id: string
  assigned_to: string | null
  full_name: string
  phone: string | null
  email: string | null
  source: string | null
  campaign_id: string | null
  status: LeadStatus
  score: number
  urgency: number
  tags: string[]
  notes: string | null
  last_contact_at: string | null
  next_action_at: string | null
  created_at: string
  updated_at: string
}

// ─── Lead Profile sub-types ────────────────────────────────────────────────────

export interface HomePreferences {
  zonas: string[]
  tipologia: string | null
  garagem: boolean | null
  elevador: boolean | null
  luz: string | null
  ruido: string | null
  exterior: boolean | null
  obras: boolean | null
  area_min: number | null
  area_max: number | null
  notas: string | null
}

export interface FinancialProfile {
  orcamento_max: number | null
  entrada_disponivel: number | null
  necessita_financiamento: boolean | null
  prestacao_max: number | null
  capitais_proprios: number | null
  estabilidade: string | null
  margem_seguranca: string | null
  notas: string | null
}

export interface PersonalityTraits {
  tipo: string | null        // analitico | emocional | pragmatico | social
  comunicacao: string | null // direto | indireto | formal | informal
  ritmo: string | null       // rapido | lento | moderado
  notas: string | null
}

export interface FamilyContext {
  num_pessoas: number | null
  filhos: boolean | null
  escolas_importantes: boolean | null
  prazo_mudanca: string | null
  situacao_atual: string | null
  notas: string | null
}

export interface FearsObjections {
  lista: string[]
  notas: string | null
}

export interface ProcessPreferences {
  frequencia_updates: string | null
  canal_preferido: string | null
  disponibilidade: string | null
  notas: string | null
}

export interface LeadProfile {
  lead_id: string
  home_preferences: HomePreferences | null
  financial_profile: FinancialProfile | null
  personality_traits: PersonalityTraits | null
  family_context: FamilyContext | null
  fears_objections: FearsObjections | null
  process_preferences: ProcessPreferences | null
  summary: string | null
  confidence_score: number | null
  updated_at: string
}

// ─── Interactions & Tasks ──────────────────────────────────────────────────────

export interface Interaction {
  id: string
  lead_id: string
  team_id: string
  type: InteractionType
  raw_text: string | null
  summary: string | null
  occurred_at: string
  created_at: string
}

export interface Task {
  id: string
  lead_id: string | null
  team_id: string
  assigned_to: string | null
  title: string
  description: string | null
  due_at: string | null
  status: TaskStatus
  priority: TaskPriority
  created_by: 'agent' | 'me'
  created_at: string
  updated_at: string
}

export interface MessageTemplate {
  id: string
  team_id: string
  channel: 'whatsapp' | 'email'
  goal: string
  tone: string
  template: string
  created_at: string
}

// ─── Agent System ──────────────────────────────────────────────────────────────

export interface AgentRun {
  id: string
  team_id: string
  agent_type: AgentType
  trigger_type: 'manual' | 'n8n_cron' | 'n8n_webhook' | null
  lead_id: string | null
  input_summary: string | null
  output_json: unknown | null
  tokens_used: number | null
  duration_ms: number | null
  status: AgentRunStatus
  error: string | null
  created_at: string
}

export interface AgentLearning {
  id: string
  team_id: string
  learning_type: 'conversion_pattern' | 'objection' | 'timing' | 'source' | 'behavior'
  content: string
  evidence_json: unknown | null
  confidence: number
  times_confirmed: number
  tags: string[]
  created_at: string
  updated_at: string
}

export interface ConversationUpload {
  id: string
  team_id: string
  lead_id: string
  kind: 'audio' | 'text'
  storage_path: string | null
  transcript_text: string | null
  objective: string | null
  processed_at: string | null
  created_at: string
}

export interface AgentExtraction {
  id: string
  team_id: string
  lead_id: string
  upload_id: string | null
  run_id: string | null
  extracted_json: AgentExtractionResult | null
  recommendations_json: AgentRecommendations | null
  drafts_json: AgentDrafts | null
  created_at: string
}

// ─── Agent Output Types ────────────────────────────────────────────────────────

export interface AgentExtractionResult {
  urgency: number                          // 1-5
  score: number                            // 0-100
  home_preferences: Partial<HomePreferences> | null
  financial_profile: Partial<FinancialProfile> | null
  personality_traits: Partial<PersonalityTraits> | null
  family_context: Partial<FamilyContext> | null
  fears_objections: Partial<FearsObjections> | null
  process_preferences: Partial<ProcessPreferences> | null
  summary: string
  confidence_score: number
  key_moments: string[]                    // momentos importantes da conversa
}

export interface AgentAction {
  title: string
  description: string
  priority: 'high' | 'medium' | 'low'
  due_in_hours: number | null
}

export interface AgentRecommendations {
  next_questions: string[]
  next_best_actions: AgentAction[]
  red_flags: string[]
  missing_info: string[]
  coaching_notes: string[]                 // notas para o agente (o humano)
}

export interface AgentDraft {
  channel: 'whatsapp' | 'email'
  tone: 'curto' | 'neutro' | 'formal'
  subject: string | null                   // apenas para email
  body: string
  goal: string
}

export interface AgentDrafts {
  drafts: AgentDraft[]
}

export interface AgentFullOutput {
  lead_updates: AgentExtractionResult
  recommendations: AgentRecommendations
  drafts: AgentDrafts
}

// ─── Follow-up Agent ───────────────────────────────────────────────────────────

export interface FollowupPlanItem {
  lead_id: string
  lead_name: string
  reason: string
  action: string
  priority: 'urgent' | 'high' | 'medium' | 'low'
  draft_message: string | null
  days_since_contact: number
}

export interface FollowupPlan {
  date: string
  items: FollowupPlanItem[]
  cold_leads: string[]                     // lead_ids sem contacto >7 dias
  summary: string
}

// ─── Marketing ────────────────────────────────────────────────────────────────

export interface Campaign {
  id: string
  team_id: string
  platform: AdPlatform
  external_id: string | null
  name: string
  status: 'active' | 'paused' | 'ended'
  budget_daily: number | null
  budget_total: number | null
  start_date: string | null
  end_date: string | null
  created_at: string
  updated_at: string
}

export interface CampaignMetric {
  id: string
  campaign_id: string
  team_id: string
  date: string
  spend: number
  impressions: number
  clicks: number
  leads_count: number
  cpl: number | null
  conversions: number
}

export interface CampaignWithMetrics extends Campaign {
  total_spend: number
  total_leads: number
  total_conversions: number
  avg_cpl: number | null
  conversion_rate: number | null
}

// ─── Notifications ────────────────────────────────────────────────────────────

export interface Notification {
  id: string
  team_id: string
  user_id: string | null
  type: NotificationType
  title: string
  body: string | null
  link: string | null
  read: boolean
  created_at: string
}

// ─── Investors & Opportunities ────────────────────────────────────────────────

export type DealType = 'buy_to_let' | 'fix_and_flip'
export type InvestmentType = 'buy_to_let' | 'buy_to_sell' | 'fix_and_flip' | 'commercial'
export type RiskLevel = 'conservative' | 'moderate' | 'aggressive'
export type InvestmentHorizon = 'short' | 'medium' | 'long'
export type InvestorStatus = 'active' | 'inactive' | 'invested'
export type OpportunityStatus = 'analyzing' | 'available' | 'under_offer' | 'closed' | 'passed'
export type MatchStatus = 'suggested' | 'presented' | 'interested' | 'rejected' | 'invested'
export type PropertyType = 'apartment' | 'house' | 'commercial' | 'land'
export type MaxRenovation = 'none' | 'light' | 'medium' | 'full'

export interface Investor {
  id: string
  team_id: string
  name: string
  email: string | null
  phone: string | null
  investment_type: InvestmentType[]
  budget_min: number | null
  budget_max: number | null
  preferred_zones: string[]
  preferred_typologies: string[]
  min_yield: number | null
  risk_level: RiskLevel
  investment_horizon: InvestmentHorizon
  needs_financing: boolean
  max_renovation: MaxRenovation
  notes: string | null
  status: InvestorStatus
  last_contact: string | null
  lead_id: string | null
  created_at: string
  updated_at: string
  // optional join
  lead?: { id: string; full_name: string; status: string; score: number } | null
}

export interface Opportunity {
  id: string
  team_id: string
  title: string
  address: string | null
  zone: string
  typology: string | null
  property_type: PropertyType
  deal_type: DealType
  asking_price: number
  negotiated_price: number | null
  area_m2: number | null
  vpt: number | null

  // Buy-to-let
  estimated_monthly_rent: number | null
  condo_fee: number
  annual_imi: number
  renovation_cost: number

  // Fix & flip — aquisição
  imposto_selo_pct: number
  escritura_cost: number

  // Fix & flip — financiamento
  financing_entry_pct: number
  financing_interest_pct: number | null
  financing_years: number | null
  financing_stamp_duty_pct: number
  financing_dossier: number
  financing_evaluation: number
  financing_formalization: number
  financing_mortgage_registry: number

  // Fix & flip — transitórios
  holding_months: number
  insurance_monthly: number
  electricity_monthly: number
  water_monthly: number

  // Fix & flip — obras detalhadas
  construction_cost: number
  operational_expenses: number
  renovation_item3: number
  renovation_item4: number
  renovation_item5: number

  // Fix & flip — venda
  estimated_sell_price: number | null
  sale_commission_pct: number
  sale_commission2_pct: number
  sale_commission3_pct: number
  early_repayment_penalty_pct: number

  // Fix & flip — split
  operator_profit_pct: number
  irc_rate: number
  reform_months: number | null
  contract_type: string | null

  status: OpportunityStatus
  source: string | null
  description: string | null
  lead_id: string | null
  created_at: string
  updated_at: string
}

export interface OpportunityInvestor {
  id: string
  team_id: string
  opportunity_id: string
  investor_id: string
  capital_invested: number
  pct_share: number | null
  tipo_associado: 'E' | 'P'
  notes: string | null
  created_at: string
  updated_at: string
  // join
  investor?: Investor
}

export interface InvestorMatch {
  id: string
  team_id: string
  investor_id: string
  opportunity_id: string
  match_score: number
  match_reasons: { reason: string; positive: boolean }[]
  ai_analysis: string | null
  pitch_draft: string | null
  status: MatchStatus
  created_at: string
  updated_at: string
  // joins
  investor?: Investor
  opportunity?: Opportunity
}

export interface RoiMetrics {
  preco_compra: number
  rendimento_anual: number
  encargos_anuais: number
  yield_bruto: number
  yield_liquido: number
  imt: number
  custos_escritura: number
  capital_total_investido: number
  cash_flow_anual: number
  cash_on_cash: number | null
  payback_anos: number | null
  plus_valia_estimada: number | null
}

export interface FixFlipMetrics {
  // Custos aquisição
  imt: number
  imposto_selo: number
  escritura: number
  total_custos_aquisicao: number

  // Financiamento
  financing_amount: number
  prestacao_mensal: number
  total_juros: number
  is_financiamento: number
  total_custos_financiamento: number

  // Obras
  total_obras: number

  // Transitórios
  total_custos_transitorios: number

  // Venda
  comissao1: number
  comissao2: number
  comissao3: number
  penalizacao: number
  total_custos_venda: number

  // Resumo negócio
  custo_total_negocio: number
  preco_venda: number
  lucro_bruto: number
  lucro_liquido_antes_impostos: number

  // Rentabilidade
  roi_total: number
  roi_anualizado: number
  cash_on_cash: number
  capital_proprio_necessario: number

  // Após IRC
  irc_valor: number
  lucro_liquido_irc: number

  // Split operador/investidores
  operador_resultado: number
  investidores_total_lucro: number

  // Por m2
  valor_m2_compra: number | null
  valor_m2_obra: number | null
  valor_m2_venda: number | null
}

export const INVESTMENT_TYPE_LABELS: Record<InvestmentType, string> = {
  buy_to_let: 'Buy-to-Let (Arrendamento)',
  buy_to_sell: 'Buy-to-Sell (Revenda)',
  fix_and_flip: 'Fix & Flip',
  commercial: 'Comercial',
}

export const RISK_LEVEL_LABELS: Record<RiskLevel, string> = {
  conservative: 'Conservador',
  moderate: 'Moderado',
  aggressive: 'Agressivo',
}

export const INVESTMENT_HORIZON_LABELS: Record<InvestmentHorizon, string> = {
  short: 'Curto prazo (<2 anos)',
  medium: 'Médio prazo (2-5 anos)',
  long: 'Longo prazo (>5 anos)',
}

export const INVESTOR_STATUS_LABELS: Record<InvestorStatus, string> = {
  active: 'Ativo',
  inactive: 'Inativo',
  invested: 'Investiu',
}

export const OPPORTUNITY_STATUS_LABELS: Record<OpportunityStatus, string> = {
  analyzing: 'Em Análise',
  available: 'Disponível',
  under_offer: 'Em Oferta',
  closed: 'Fechado',
  passed: 'Passou',
}

export const MATCH_STATUS_LABELS: Record<MatchStatus, string> = {
  suggested: 'Sugerido',
  presented: 'Apresentado',
  interested: 'Interessado',
  rejected: 'Rejeitado',
  invested: 'Investiu',
}

export const PROPERTY_TYPE_LABELS: Record<PropertyType, string> = {
  apartment: 'Apartamento',
  house: 'Moradia',
  commercial: 'Comercial',
  land: 'Terreno',
}

export const MAX_RENOVATION_LABELS: Record<MaxRenovation, string> = {
  none: 'Sem obras',
  light: 'Obras ligeiras',
  medium: 'Obras médias',
  full: 'Remodelação total',
}

// ─── View Models ──────────────────────────────────────────────────────────────

export interface LeadWithProfile extends Lead {
  lead_profiles: LeadProfile | null
}

export interface LeadWithStats extends Lead {
  interactions_count: number
  tasks_open_count: number
  last_extraction: AgentExtraction | null
}

// ─── API Payloads ─────────────────────────────────────────────────────────────

export interface CreateLeadPayload {
  full_name: string
  phone?: string
  email?: string
  source?: string
  notes?: string
}

export interface AnalyzeConversationPayload {
  lead_id: string
  conversation_text: string
  objective: string
  upload_id?: string
}

export interface CreateTaskPayload {
  lead_id?: string
  title: string
  description?: string
  due_at?: string
  priority?: TaskPriority
  assigned_to?: string
}

// ─── Display Constants ────────────────────────────────────────────────────────

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: 'Novo',
  qualified: 'Qualificado',
  meeting: 'Reunião',
  active: 'Ativo',
  won: 'Ganho',
  lost: 'Perdido',
}

export const LEAD_STATUS_COLORS: Record<LeadStatus, string> = {
  new: 'bg-blue-100 text-blue-800',
  qualified: 'bg-purple-100 text-purple-800',
  meeting: 'bg-yellow-100 text-yellow-800',
  active: 'bg-green-100 text-green-800',
  won: 'bg-emerald-100 text-emerald-800',
  lost: 'bg-red-100 text-red-800',
}

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: 'Baixa',
  medium: 'Média',
  high: 'Alta',
  urgent: 'Urgente',
}

export const TASK_PRIORITY_COLORS: Record<TaskPriority, string> = {
  low: 'bg-gray-100 text-gray-600',
  medium: 'bg-blue-100 text-blue-700',
  high: 'bg-orange-100 text-orange-700',
  urgent: 'bg-red-100 text-red-700',
}

export const AD_PLATFORM_LABELS: Record<AdPlatform, string> = {
  meta: 'Facebook / Meta',
  google: 'Google Ads',
  tiktok: 'TikTok Ads',
  organic: 'Orgânico',
  other: 'Outro',
}

export const LEAD_PIPELINE_ORDER: LeadStatus[] = [
  'new', 'qualified', 'meeting', 'active', 'won', 'lost',
]

export const LEAD_SOURCE_OPTIONS = [
  'facebook_ads',
  'google_ads',
  'tiktok_ads',
  'referral',
  'website',
  'idealista',
  'imovirtual',
  'other',
] as const

export const INTERACTION_TYPE_LABELS: Record<InteractionType, string> = {
  call: 'Chamada',
  whatsapp: 'WhatsApp',
  email: 'Email',
  meeting: 'Reunião',
  note: 'Nota',
  audio: 'Áudio',
}

export const CONVERSATION_OBJECTIVES = [
  { value: 'qualificar', label: 'Qualificar lead' },
  { value: 'reuniao', label: 'Marcar reunião' },
  { value: 'followup', label: 'Follow-up geral' },
  { value: 'pos_visita', label: 'Pós-visita' },
  { value: 'pos_chamada', label: 'Pós-chamada' },
  { value: 'negociacao', label: 'Negociação' },
  { value: 'outro', label: 'Outro' },
] as const
