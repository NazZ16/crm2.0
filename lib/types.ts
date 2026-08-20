// ─── Enums ────────────────────────────────────────────────────────────────────

export type LeadStatus = 'new' | 'qualified' | 'meeting' | 'active' | 'cpcv' | 'escriturado' | 'won' | 'lost'
export type InteractionType = 'call' | 'whatsapp' | 'email' | 'meeting' | 'note' | 'audio'
export type InteractionOutcome = 'sugerido' | 'visitado' | 'proposta' | 'rejeitado'
export type RejectionReason = 'preco' | 'localizacao' | 'estado_imovel' | 'timing' | 'tipologia' | 'outro'
export type TaskStatus = 'open' | 'done'
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent'
export type TeamRole = 'admin' | 'agent' | 'viewer'
export type AdPlatform = 'meta' | 'google' | 'tiktok' | 'organic' | 'other'
export type AgentType = 'lead' | 'followup' | 'coach' | 'marketing' | 'investor' | 'orientator'
export type AgentRunStatus = 'running' | 'done' | 'failed'
export type NotificationType = 'agent_complete' | 'cold_lead' | 'task_due' | 'tip' | 'info'
export type ContentStatus = 'idea' | 'draft' | 'scheduled' | 'published' | 'archived'
export type ContentPlatform = 'linkedin' | 'instagram' | 'tiktok' | 'youtube' | 'blog' | 'other'

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
  // Tracking financeiro (migration 014)
  deal_value: number | null         // valor do imovel (EUR)
  commission_value: number | null   // comissao recebida (EUR) - KPI 50k
  closed_at: string | null          // data efectiva de fecho
  // Tipo de lead (migration 015) — comprador vs vendedor (angariacao)
  lead_type: LeadType
  // Sub-estados do fecho (migration 020)
  cpcv_date: string | null          // data de assinatura do CPCV
  escritura_date: string | null     // data da escritura
  // Sync com Google Contacts (migration 033)
  google_contact_resource_name: string | null
  google_contact_synced_at: string | null
  created_at: string
  updated_at: string
}

// ─── Lead Profile sub-types ────────────────────────────────────────────────────

export interface HomePreferences {
  zonas: string[]
  tipologia: string | null
  tipo_negocio: ListingBusinessType | null
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
  tipo: string | null
  comunicacao: string | null
  ritmo: string | null
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

// ─── Seller Profile (angariacao) ──────────────────────────────────────────────
// So preenchido quando leads.lead_type IN ('seller', 'both').
// Captura o que e relevante para VENDER o imovel do cliente, nao o que ele procura.

export interface SellerImovel {
  morada: string | null
  freguesia: string | null
  concelho: string | null
  tipologia: string | null
  area_util_m2: number | null
  area_bruta_m2: number | null
  ano_construcao: number | null
  certificado_energetico: string | null
  andar: string | null
  elevador: boolean | null
  varanda: boolean | null
  garagem: boolean | null
  estado: string | null
  link_anuncio: string | null
  notas: string | null
}

export interface SellerHistorico {
  ja_tentou_vender: boolean | null
  mediadora_anterior: string | null
  tempo_no_mercado_meses: number | null
  preco_anunciado_anterior: number | null
  motivo_nao_vendeu: string | null
}

export interface SellerObjectivo {
  preco_pedido: number | null
  preco_minimo_aceitavel: number | null
  prazo_venda_meses: number | null
  motivacao: string | null
  flexibilidade_preco: string | null
  urgencia_1_5: number | null
}

export interface SellerDocumentacao {
  caderneta_predial: boolean | null
  registo_predial: boolean | null
  licenca_habitacao: boolean | null
  ce_disponivel: boolean | null
  ipt_pago: boolean | null
  notas_legais: string | null
}

export interface SellerProfile {
  imovel: SellerImovel | null
  historico: SellerHistorico | null
  objectivo: SellerObjectivo | null
  documentacao: SellerDocumentacao | null
  notas: string | null
}

export type LeadType = 'buyer' | 'seller' | 'both' | 'unknown'

export const LEAD_TYPE_LABELS: Record<LeadType, string> = {
  buyer: 'Comprador',
  seller: 'Vendedor',
  both: 'Comprador + Vendedor',
  unknown: 'Por classificar',
}

export const LEAD_TYPE_COLORS: Record<LeadType, string> = {
  buyer: 'bg-blue-100 text-blue-700',
  seller: 'bg-amber-100 text-amber-800',
  both: 'bg-purple-100 text-purple-700',
  unknown: 'bg-gray-100 text-gray-600',
}

export interface LeadProfile {
  lead_id: string
  home_preferences: HomePreferences | null
  financial_profile: FinancialProfile | null
  personality_traits: PersonalityTraits | null
  family_context: FamilyContext | null
  fears_objections: FearsObjections | null
  process_preferences: ProcessPreferences | null
  seller_profile: SellerProfile | null
  summary: string | null
  confidence_score: number | null
  updated_at: string
  // Camada semântica de matching (migration 032)
  embedding?: number[] | string | null
  embedding_updated_at?: string | null
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
  // Feedback de match lead↔imóvel (migration 031)
  listing_id: string | null
  outcome: InteractionOutcome | null
  rejection_reason: RejectionReason | null
}

export const INTERACTION_OUTCOME_LABELS: Record<InteractionOutcome, string> = {
  sugerido: 'Sugerido',
  visitado: 'Visitado',
  proposta: 'Proposta feita',
  rejeitado: 'Rejeitado',
}

export const REJECTION_REASON_LABELS: Record<RejectionReason, string> = {
  preco: 'Preço',
  localizacao: 'Localização',
  estado_imovel: 'Estado do imóvel',
  timing: 'Timing',
  tipologia: 'Tipologia',
  outro: 'Outro',
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

export type AgentExtractionStatus = 'pending' | 'applied' | 'dismissed'

export interface AgentExtraction {
  id: string
  team_id: string
  lead_id: string
  upload_id: string | null
  run_id: string | null
  extracted_json: AgentExtractionResult | null
  recommendations_json: AgentRecommendations | null
  drafts_json: AgentDrafts | null
  status: AgentExtractionStatus
  applied_at: string | null
  created_at: string
}

// ─── Agent Output Types ────────────────────────────────────────────────────────

export interface AgentExtractionResult {
  lead_type?: LeadType                                     // novo (migration 015)
  urgency: number
  score: number
  full_name: string | null
  phone: string | null
  email: string | null
  home_preferences: Partial<HomePreferences> | null
  financial_profile: Partial<FinancialProfile> | null
  personality_traits: Partial<PersonalityTraits> | null
  family_context: Partial<FamilyContext> | null
  fears_objections: Partial<FearsObjections> | null
  process_preferences: Partial<ProcessPreferences> | null
  seller_profile?: Partial<SellerProfile> | null           // novo (migration 015)
  summary: string
  confidence_score: number
  key_moments: string[]
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
  coaching_notes: string[]
}

export interface AgentDraft {
  channel: 'whatsapp' | 'email'
  tone: 'curto' | 'neutro' | 'formal'
  subject: string | null
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
  cold_leads: string[]
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

// ─── Content pipeline (marca pessoal) ──────────────────────────────────────────

export interface ContentPiece {
  id: string
  team_id: string
  title: string
  platform: ContentPlatform
  status: ContentStatus
  idea_text: string | null
  draft_content: string | null
  scheduled_at: string | null
  published_at: string | null
  published_url: string | null
  source: 'manual' | 'hub_telegram'
  created_at: string
  updated_at: string
}

// ─── Partners (directorio de parceiros de confianca) ──────────────────────────

export type PartnerCategory =
  | 'credito' | 'advogado' | 'seguradora' | 'fiscalizador' | 'empreiteiro'
  | 'eletricista' | 'canalizador' | 'pintor' | 'eletrodomesticos' | 'limpeza'
  | 'transportadora' | 'outro'

export interface Partner {
  id: string
  team_id: string
  name: string
  category: PartnerCategory
  phone: string | null
  email: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export const PARTNER_CATEGORY_LABELS: Record<PartnerCategory, string> = {
  credito: 'Intermediário de Crédito',
  advogado: 'Advogado',
  seguradora: 'Seguradora',
  fiscalizador: 'Fiscalizador',
  empreiteiro: 'Empreiteiro',
  eletricista: 'Eletricista',
  canalizador: 'Canalizador',
  pintor: 'Pintor',
  eletrodomesticos: 'Reparação de Eletrodomésticos',
  limpeza: 'Limpeza',
  transportadora: 'Transportadora',
  outro: 'Outro',
}

export const PARTNER_CATEGORY_ORDER: PartnerCategory[] = [
  'credito', 'advogado', 'seguradora', 'fiscalizador', 'empreiteiro',
  'eletricista', 'canalizador', 'pintor', 'eletrodomesticos', 'limpeza',
  'transportadora', 'outro',
]

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

  estimated_monthly_rent: number | null
  condo_fee: number
  annual_imi: number
  renovation_cost: number

  imposto_selo_pct: number
  escritura_cost: number

  financing_entry_pct: number
  financing_interest_pct: number | null
  financing_years: number | null
  financing_stamp_duty_pct: number
  financing_dossier: number
  financing_evaluation: number
  financing_formalization: number
  financing_mortgage_registry: number

  holding_months: number
  insurance_monthly: number
  electricity_monthly: number
  water_monthly: number

  construction_cost: number
  operational_expenses: number
  renovation_item3: number
  renovation_item4: number
  renovation_item5: number

  estimated_sell_price: number | null
  sale_commission_pct: number
  sale_commission2_pct: number
  sale_commission3_pct: number
  early_repayment_penalty_pct: number

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
  imt: number
  imposto_selo: number
  escritura: number
  total_custos_aquisicao: number

  financing_amount: number
  prestacao_mensal: number
  total_juros: number
  is_financiamento: number
  total_custos_financiamento: number

  total_obras: number

  total_custos_transitorios: number

  comissao1: number
  comissao2: number
  comissao3: number
  penalizacao: number
  total_custos_venda: number

  custo_total_negocio: number
  preco_venda: number
  lucro_bruto: number
  lucro_liquido_antes_impostos: number

  roi_total: number
  roi_anualizado: number
  cash_on_cash: number
  capital_proprio_necessario: number

  irc_valor: number
  lucro_liquido_irc: number

  operador_resultado: number
  investidores_total_lucro: number

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
  medium: 'Medio prazo (2-5 anos)',
  long: 'Longo prazo (>5 anos)',
}

export const INVESTOR_STATUS_LABELS: Record<InvestorStatus, string> = {
  active: 'Ativo',
  inactive: 'Inativo',
  invested: 'Investiu',
}

export const OPPORTUNITY_STATUS_LABELS: Record<OpportunityStatus, string> = {
  analyzing: 'Em Analise',
  available: 'Disponivel',
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
  medium: 'Obras medias',
  full: 'Remodelacao total',
}

// ─── Listings (imóveis para venda/arrendamento — diferente de Opportunity) ────
// Opportunity = módulo de investidores (fix&flip/buy-to-let, com ROI).
// Listing = imóvel normal (próprio ou angariação) para dar match com leads
// compradores usando lead_profiles.home_preferences / financial_profile.

export type ListingBusinessType = 'venda' | 'arrendamento'
export type ListingPropertyType =
  | 'apartamento' | 'moradia' | 'terreno' | 'comercial' | 'garagem' | 'outro'
  | 'quinta' | 'loja' | 'armazem' | 'escritorio' | 'predio'
export type ListingStatus = 'active' | 'reserved' | 'sold' | 'withdrawn'

export interface Listing {
  id: string
  team_id: string
  reference: string | null
  title: string
  business_type: ListingBusinessType
  property_type: ListingPropertyType
  typology: string | null
  price: number | null
  condo_fee: number | null
  imi_annual: number | null

  district: string | null
  municipality: string | null
  parish: string | null
  zone: string | null
  address: string | null
  zip_code: string | null
  latitude: number | null
  longitude: number | null

  area_useful_m2: number | null
  area_gross_m2: number | null
  area_plot_m2: number | null
  bedrooms: number | null
  bathrooms: number | null
  total_rooms: number | null
  parking_spaces: number | null
  has_elevator: boolean | null
  construction_year: number | null
  energy_rating: string | null

  features: string[]
  description: string | null
  cover_image_url: string | null
  photos: string[]

  source: string | null
  source_url: string | null
  status: ListingStatus
  is_published: boolean | null
  lead_id: string | null
  notes: string | null

  agent_name: string | null
  agent_phone: string | null
  agent_email: string | null

  days_on_market: number | null
  visit_count: number | null
  proposal_count: number | null

  // Camada semântica de matching (migration 032)
  embedding?: number[] | string | null
  embedding_updated_at?: string | null

  created_at: string
  updated_at: string
}

export interface ListingExtractionResult {
  reference: string | null
  title: string | null
  business_type: ListingBusinessType | null
  property_type: ListingPropertyType | null
  typology: string | null
  price: number | null
  condo_fee: number | null
  imi_annual: number | null
  district: string | null
  municipality: string | null
  parish: string | null
  address: string | null
  zip_code: string | null
  latitude: number | null
  longitude: number | null
  area_useful_m2: number | null
  area_gross_m2: number | null
  area_plot_m2: number | null
  bedrooms: number | null
  bathrooms: number | null
  total_rooms: number | null
  parking_spaces: number | null
  has_elevator: boolean | null
  construction_year: number | null
  energy_rating: string | null
  features: string[]
  description: string | null
  cover_image_url: string | null
  source_url: string | null
}

export interface ListingMatchResult {
  lead_id: string
  lead_name: string
  score: number
  reasons: Array<{ reason: string; positive: boolean }>
}

export interface LeadListingMatchResult {
  listing_id: string
  listing_title: string
  listing_price: number | null
  listing_business_type: ListingBusinessType
  listing_property_type: ListingPropertyType
  score: number
  reasons: Array<{ reason: string; positive: boolean }>
}

export const LISTING_BUSINESS_TYPE_LABELS: Record<ListingBusinessType, string> = {
  venda: 'Venda',
  arrendamento: 'Arrendamento',
}

export const LISTING_PROPERTY_TYPE_LABELS: Record<ListingPropertyType, string> = {
  apartamento: 'Apartamento',
  moradia: 'Moradia',
  terreno: 'Terreno',
  comercial: 'Comercial',
  garagem: 'Garagem',
  outro: 'Outro',
  quinta: 'Quinta',
  loja: 'Loja',
  armazem: 'Armazém',
  escritorio: 'Escritório',
  predio: 'Prédio',
}

export const LISTING_STATUS_LABELS: Record<ListingStatus, string> = {
  active: 'Ativo',
  reserved: 'Reservado',
  sold: 'Vendido',
  withdrawn: 'Retirado',
}

export const LISTING_STATUS_COLORS: Record<ListingStatus, string> = {
  active: 'bg-green-100 text-green-800',
  reserved: 'bg-yellow-100 text-yellow-800',
  sold: 'bg-gray-100 text-gray-600',
  withdrawn: 'bg-red-100 text-red-700',
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
  meeting: 'Reuniao',
  active: 'Ativo',
  cpcv: 'CPCV',
  escriturado: 'Escriturado',
  won: 'Ganho',
  lost: 'Perdido',
}

export const LEAD_STATUS_COLORS: Record<LeadStatus, string> = {
  new: 'bg-blue-100 text-blue-800',
  qualified: 'bg-purple-100 text-purple-800',
  meeting: 'bg-yellow-100 text-yellow-800',
  active: 'bg-green-100 text-green-800',
  cpcv: 'bg-indigo-100 text-indigo-800',
  escriturado: 'bg-teal-100 text-teal-800',
  won: 'bg-emerald-100 text-emerald-800',
  lost: 'bg-red-100 text-red-800',
}

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: 'Baixa',
  medium: 'Media',
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
  organic: 'Organico',
  other: 'Outro',
}

export const CONTENT_STATUS_LABELS: Record<ContentStatus, string> = {
  idea: 'Ideia',
  draft: 'Rascunho',
  scheduled: 'Agendado',
  published: 'Publicado',
  archived: 'Arquivado',
}

export const CONTENT_STATUS_COLORS: Record<ContentStatus, string> = {
  idea: 'bg-gray-100 text-gray-700',
  draft: 'bg-blue-100 text-blue-700',
  scheduled: 'bg-yellow-100 text-yellow-800',
  published: 'bg-green-100 text-green-800',
  archived: 'bg-gray-100 text-gray-400',
}

export const CONTENT_STATUS_ORDER: ContentStatus[] = ['idea', 'draft', 'scheduled', 'published']

export const CONTENT_PLATFORM_LABELS: Record<ContentPlatform, string> = {
  linkedin: 'LinkedIn',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  blog: 'Blog',
  other: 'Outro',
}

export const LEAD_PIPELINE_ORDER: LeadStatus[] = [
  'new', 'qualified', 'meeting', 'active', 'cpcv', 'escriturado', 'won', 'lost',
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
  meeting: 'Reuniao',
  note: 'Nota',
  audio: 'Audio',
}

export const CONVERSATION_OBJECTIVES = [
  { value: 'qualificar', label: 'Qualificar lead' },
  { value: 'reuniao', label: 'Marcar reuniao' },
  { value: 'followup', label: 'Follow-up geral' },
  { value: 'pos_visita', label: 'Pos-visita' },
  { value: 'pos_chamada', label: 'Pos-chamada' },
  { value: 'negociacao', label: 'Negociacao' },
  { value: 'outro', label: 'Outro' },
] as const
