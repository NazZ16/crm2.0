// lib/auto-tasks.ts
// Cria tarefas de follow-up automaticamente quando uma lead muda de status.
//
// Estrategia:
//   - Cada transicao (oldStatus -> newStatus) tem 1+ tasks associadas por tipo de lead
//   - Buyer e Seller tem tasks diferentes (vocabulario e accoes diferentes)
//   - Dedup por (lead_id, trigger_key): nao cria se ja existe task aberta com
//     o mesmo trigger key na descricao
//
// Marcamos cada task com tag invisivel "[auto:trigger=KEY]" para dedup.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { LeadStatus, LeadType, TaskPriority } from '@/lib/types'
import { LEAD_PIPELINE_ORDER } from '@/lib/types'

interface AutoTaskRule {
  /** Identificador unico do trigger (usado para dedup). Ex: "new->qualified", "won-6m", "won-anniv-1y" */
  triggerKey: string
  title: string
  description: string
  priority: TaskPriority
  /** Quantos dias no futuro deve ser o due_at */
  dueInDays: number
}

type TransitionKey = `${LeadStatus}->${LeadStatus}`

// Tasks para BUYERS (compradores)
const BUYER_RULES: Partial<Record<TransitionKey, AutoTaskRule[]>> = {
  'new->qualified': [
    {
      triggerKey: 'new->qualified',
      title: 'Marcar primeiro contacto / apresentar shortlist',
      description: 'Lead qualificada — agenda WhatsApp ou chamada para apresentar primeiros imoveis e perceber timing.',
      priority: 'medium',
      dueInDays: 3,
    },
  ],
  'qualified->meeting': [
    {
      triggerKey: 'qualified->meeting',
      title: 'Confirmar visita 24h antes',
      description: 'Reuniao agendada — confirma local, hora e estado emocional. Re-envia morada e detalhes.',
      priority: 'high',
      dueInDays: 1,
    },
  ],
  'meeting->active': [
    {
      triggerKey: 'meeting->active',
      title: 'Confirmar interesse pos-visita',
      description: 'Visita feita — sente o interesse real, identifica objeccoes pendentes e proximo passo concreto (proposta? segunda visita?).',
      priority: 'medium',
      dueInDays: 5,
    },
  ],
  'active->cpcv': [
    {
      triggerKey: 'active->cpcv',
      title: 'Preparar documentacao para CPCV',
      description: 'Proposta aceite — reune documentacao necessaria (identificacao, comprovativo de morada, financiamento) e agenda assinatura do CPCV.',
      priority: 'high',
      dueInDays: 3,
    },
  ],
  'cpcv->escriturado': [
    {
      triggerKey: 'cpcv->escriturado',
      title: 'Confirmar data e local da escritura',
      description: 'CPCV assinado — confirma data/local da escritura com notario/banco, e que toda a documentacao esta pronta.',
      priority: 'high',
      dueInDays: 2,
    },
  ],
  // Won (via escriturado): 3 tasks — referencias (curto prazo) + check-in 6m + aniversario 1 ano.
  // Anos 2+ sao criados pelo cron /api/cron/anniversaries.
  'escriturado->won': [
    {
      triggerKey: 'won-referrals',
      title: 'Pedir referencias e testemunho',
      description: 'Deal fechada — celebra, pede referencias de amigos/familia e um testemunho curto para uso em redes sociais.',
      priority: 'low',
      dueInDays: 7,
    },
    {
      triggerKey: 'won-6m',
      title: 'Check-in 6 meses na nova casa',
      description: 'Ja la moram ha 6 meses — liga para saber como esta a correr, se ha pontos a resolver, e se conhecem alguem a comprar/vender. Cliente satisfeito = referencia.',
      priority: 'medium',
      dueInDays: 180,
    },
    {
      triggerKey: 'won-1y',
      title: 'Parabens 1.o aniversario da nova casa',
      description: 'Faz 1 ano hoje desde a escritura. Mensagem curta de parabens, pergunta como tem corrido, recorda que estas la para qualquer questao.',
      priority: 'low',
      dueInDays: 365,
    },
  ],
  // Fallback: se a lead saltar directamente de active para won (sem passar por cpcv/escriturado).
  'active->won': [
    {
      triggerKey: 'won-referrals',
      title: 'Pedir referencias e testemunho',
      description: 'Deal fechada — celebra, pede referencias de amigos/familia e um testemunho curto para uso em redes sociais.',
      priority: 'low',
      dueInDays: 7,
    },
    {
      triggerKey: 'won-6m',
      title: 'Check-in 6 meses na nova casa',
      description: 'Ja la moram ha 6 meses — liga para saber como esta a correr, se ha pontos a resolver, e se conhecem alguem a comprar/vender. Cliente satisfeito = referencia.',
      priority: 'medium',
      dueInDays: 180,
    },
    {
      triggerKey: 'won-1y',
      title: 'Parabens 1.o aniversario da nova casa',
      description: 'Faz 1 ano hoje desde a escritura. Mensagem curta de parabens, pergunta como tem corrido, recorda que estas la para qualquer questao.',
      priority: 'low',
      dueInDays: 365,
    },
  ],
}

// Tasks para SELLERS (vendedores — angariacao)
const SELLER_RULES: Partial<Record<TransitionKey, AutoTaskRule[]>> = {
  'new->qualified': [
    {
      triggerKey: 'new->qualified',
      title: 'Agendar avaliacao do imovel',
      description: 'Vendedor qualificado — agenda visita ao imovel para avaliacao. Pede entretanto a caderneta predial e CE.',
      priority: 'medium',
      dueInDays: 3,
    },
  ],
  'qualified->meeting': [
    {
      triggerKey: 'qualified->meeting',
      title: 'Preparar avaliacao do imovel',
      description: 'Avaliacao agendada — prepara comparaveis na zona, dossier de mediacao e proposta de preco-alvo.',
      priority: 'high',
      dueInDays: 1,
    },
  ],
  'meeting->active': [
    {
      triggerKey: 'meeting->active',
      title: 'Apresentar contrato de mediacao',
      description: 'Avaliacao feita — formaliza contrato de mediacao, revisao do preco pedido e plano de divulgacao.',
      priority: 'high',
      dueInDays: 3,
    },
  ],
  'active->cpcv': [
    {
      triggerKey: 'active->cpcv',
      title: 'Preparar documentacao para CPCV',
      description: 'Comprador encontrado — reune caderneta predial, registo, CE e restante documentacao para a assinatura do CPCV.',
      priority: 'high',
      dueInDays: 3,
    },
  ],
  'cpcv->escriturado': [
    {
      triggerKey: 'cpcv->escriturado',
      title: 'Confirmar data e local da escritura',
      description: 'CPCV assinado — confirma data/local da escritura e que a documentacao do imovel esta pronta.',
      priority: 'high',
      dueInDays: 2,
    },
  ],
  // Won (venda concluida, via escriturado): manter o cliente quente para futura compra ou referencias
  'escriturado->won': [
    {
      triggerKey: 'won-referrals',
      title: 'Pedir referencias e testemunho ao vendedor',
      description: 'Venda concluida — pede contactos de outros proprietarios na zona que possam querer vender e um testemunho.',
      priority: 'low',
      dueInDays: 7,
    },
    {
      triggerKey: 'won-6m',
      title: 'Check-in 6 meses pos-venda',
      description: 'Passaram 6 meses desde a venda — liga para perguntar como tem corrido a vida nova, e se ha alguem no circulo que esteja a vender ou comprar.',
      priority: 'medium',
      dueInDays: 180,
    },
    {
      triggerKey: 'won-1y',
      title: 'Aniversario 1 ano da venda',
      description: 'Faz 1 ano desde a venda. Mensagem curta a recordar o trabalho conjunto e a renovar disponibilidade para nova operacao.',
      priority: 'low',
      dueInDays: 365,
    },
  ],
  // Fallback: se a lead saltar directamente de active para won (sem passar por cpcv/escriturado).
  'active->won': [
    {
      triggerKey: 'won-referrals',
      title: 'Pedir referencias e testemunho ao vendedor',
      description: 'Venda concluida — pede contactos de outros proprietarios na zona que possam querer vender e um testemunho.',
      priority: 'low',
      dueInDays: 7,
    },
    {
      triggerKey: 'won-6m',
      title: 'Check-in 6 meses pos-venda',
      description: 'Passaram 6 meses desde a venda — liga para perguntar como tem corrido a vida nova, e se ha alguem no circulo que esteja a vender ou comprar.',
      priority: 'medium',
      dueInDays: 180,
    },
    {
      triggerKey: 'won-1y',
      title: 'Aniversario 1 ano da venda',
      description: 'Faz 1 ano desde a venda. Mensagem curta a recordar o trabalho conjunto e a renovar disponibilidade para nova operacao.',
      priority: 'low',
      dueInDays: 365,
    },
  ],
}

function pickRules(leadType: LeadType): Partial<Record<TransitionKey, AutoTaskRule[]>> {
  if (leadType === 'seller') return SELLER_RULES
  return BUYER_RULES
}

/**
 * Gera tag invisivel para dedup. Vai parar a description.
 */
function tag(triggerKey: string): string {
  return `[auto:${triggerKey}]`
}

/**
 * Extrai a fase de pipeline associada a um trigger key, quando aplicavel.
 * "new->qualified" -> "qualified". "won-6m" / "won-anniv-2y" -> "won".
 * "stale" (lib/stale-leads.ts) -> null, nao esta ligado a uma fase do pipeline.
 */
export function triggerStage(triggerKey: string): LeadStatus | null {
  if (triggerKey.startsWith('won-')) return 'won'
  const [, target] = triggerKey.split('->')
  return target ? (target as LeadStatus) : null
}

/**
 * Cancela (apaga) auto-tasks abertas de uma lead cujo trigger key corresponda a
 * `matches`. So afecta tasks criadas pelo agente (created_by: 'agent') com a tag
 * [auto:*] na description — tasks manuais do utilizador nunca sao tocadas.
 *
 * @returns lista de titulos das tasks canceladas
 */
export async function cancelObsoleteAutoTasks(
  supabase: SupabaseClient,
  params: { leadId: string; teamId: string; matches: (triggerKey: string) => boolean }
): Promise<string[]> {
  const { leadId, teamId, matches } = params

  const { data: openTasks, error } = await supabase
    .from('tasks')
    .select('id, title, description')
    .eq('lead_id', leadId)
    .eq('team_id', teamId)
    .eq('status', 'open')
    .eq('created_by', 'agent')

  if (error || !openTasks?.length) return []

  const toDeleteIds: string[] = []
  const toDeleteTitles: string[] = []
  for (const task of openTasks as Array<{ id: string; title: string; description: string | null }>) {
    const match = task.description?.match(/\[auto:([^\]]+)\]/)
    if (!match) continue
    if (matches(match[1])) {
      toDeleteIds.push(task.id)
      toDeleteTitles.push(task.title)
    }
  }

  if (toDeleteIds.length === 0) return []

  const { error: deleteError } = await supabase.from('tasks').delete().in('id', toDeleteIds)
  if (deleteError) {
    console.warn(`[auto-tasks] cancelamento falhou para ${leadId}: ${deleteError.message}`)
    return []
  }

  console.log(`[auto-tasks] canceladas ${toDeleteTitles.length} tasks obsoletas para ${leadId}: ${toDeleteTitles.join(', ')}`)
  return toDeleteTitles
}

/**
 * Aplica auto-tasks para a transicao. Pode criar 0, 1 ou multiplas tasks.
 * Idempotente: se ja existe task aberta com o mesmo trigger tag, salta.
 *
 * Depois de criar as tasks da transicao actual, cancela auto-tasks obsoletas:
 * tasks ligadas a fases anteriores a newStatus (ja ultrapassadas), e a task de
 * recontacto [auto:stale] se existir (mudar de estado e evidencia de engagement).
 *
 * @returns lista de titulos das tasks criadas
 */
export async function applyAutoTaskOnStatusChange(
  supabase: SupabaseClient,
  params: {
    leadId: string
    teamId: string
    oldStatus: LeadStatus
    newStatus: LeadStatus
    leadType: LeadType
    assignedTo?: string | null
    /** Data efectiva de fecho (closed_at) — usada para tasks tipo "1 ano apos fecho". Se null, usa agora. */
    closedAt?: string | null
  }
): Promise<string[]> {
  const { leadId, teamId, oldStatus, newStatus, leadType, assignedTo, closedAt } = params

  if (oldStatus === newStatus) return []

  const transition = `${oldStatus}->${newStatus}` as TransitionKey
  const rules = pickRules(leadType)
  const ruleList = rules[transition] ?? []

  // Para tasks pos-won, o due_at conta a partir de closed_at (data de fecho real),
  // nao de hoje — porque um closed_at antigo a ser actualizado deve ainda criar
  // tasks com prazos relativos ao fecho.
  const baseDate = closedAt ? new Date(closedAt) : new Date()

  const created: string[] = []
  for (const rule of ruleList) {
    // Dedup
    const { data: existing } = await supabase
      .from('tasks')
      .select('id')
      .eq('lead_id', leadId)
      .eq('team_id', teamId)
      .like('description', `%${tag(rule.triggerKey)}%`)
      .maybeSingle()

    if (existing) continue

    const dueAt = new Date(baseDate)
    dueAt.setDate(dueAt.getDate() + rule.dueInDays)
    dueAt.setHours(9, 0, 0, 0)

    const description = `${rule.description}\n\n${tag(rule.triggerKey)}`

    const { error } = await supabase.from('tasks').insert({
      team_id: teamId,
      lead_id: leadId,
      title: rule.title,
      description,
      priority: rule.priority,
      status: 'open',
      due_at: dueAt.toISOString(),
      assigned_to: assignedTo ?? null,
      created_by: 'agent',
    })

    if (error) {
      console.warn(`[auto-tasks] insert falhou (${rule.triggerKey}): ${error.message}`)
      continue
    }
    created.push(rule.title)
    console.log(`[auto-tasks] criada "${rule.title}" para ${leadId} (${rule.triggerKey}, ${leadType})`)
  }

  // Cancela auto-tasks ligadas a fases ja ultrapassadas (indice < newStatus na
  // pipeline — isto tambem apanha "lost", que fica no fim da ordem, cancelando
  // tudo incluindo tasks won-*), e a task de recontacto [auto:stale] se existir
  // (mudar de estado e evidencia de que a lead voltou a ter engagement).
  const newStatusIndex = LEAD_PIPELINE_ORDER.indexOf(newStatus)
  await cancelObsoleteAutoTasks(supabase, {
    leadId,
    teamId,
    matches: (key) => {
      if (key === 'stale') return true
      const stage = triggerStage(key)
      if (!stage) return false
      const stageIndex = LEAD_PIPELINE_ORDER.indexOf(stage)
      return stageIndex !== -1 && stageIndex < newStatusIndex
    },
  })

  return created
}

/**
 * Cria a task de aniversario anual para uma lead won, se aplicavel.
 * Usado pelo cron /api/cron/anniversaries (corre diariamente).
 *
 * Regra: hoje e aniversario (mesmo mes+dia que closed_at) e ja passaram >= 2 anos.
 * Para anos 0 e 1 sao criados no momento do active->won via applyAutoTaskOnStatusChange.
 */
export async function applyAnniversaryTask(
  supabase: SupabaseClient,
  params: {
    leadId: string
    teamId: string
    leadType: LeadType
    closedAt: string
    assignedTo?: string | null
  }
): Promise<string | null> {
  const { leadId, teamId, leadType, closedAt, assignedTo } = params

  const closed = new Date(closedAt)
  const now = new Date()
  const yearsPassed = now.getFullYear() - closed.getFullYear()

  // So criamos a partir de 2 anos (ano 1 ja foi criado no active->won)
  if (yearsPassed < 2) return null

  // Confirma que hoje e o dia/mes do aniversario
  if (closed.getMonth() !== now.getMonth() || closed.getDate() !== now.getDate()) return null

  const triggerKey = `won-anniv-${yearsPassed}y`
  const tagStr = tag(triggerKey)

  // Dedup
  const { data: existing } = await supabase
    .from('tasks')
    .select('id')
    .eq('lead_id', leadId)
    .eq('team_id', teamId)
    .like('description', `%${tagStr}%`)
    .maybeSingle()
  if (existing) return null

  const isSeller = leadType === 'seller'
  const title = isSeller
    ? `Aniversario ${yearsPassed} anos da venda`
    : `Parabens ${yearsPassed}.o aniversario da nova casa`
  const description = isSeller
    ? `Hoje faz ${yearsPassed} anos desde a venda. Mensagem curta de "ainda me lembro de ti, espero que tudo bem". Cliente quente para nova operacao ou referencias.\n\n${tagStr}`
    : `Hoje faz ${yearsPassed} anos desde a escritura. Manda parabens curtos, pergunta como tem corrido, recorda disponibilidade. Maior probabilidade de virar referral.\n\n${tagStr}`

  const dueAt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0).toISOString()

  const { error } = await supabase.from('tasks').insert({
    team_id: teamId,
    lead_id: leadId,
    title,
    description,
    priority: 'low',
    status: 'open',
    due_at: dueAt,
    assigned_to: assignedTo ?? null,
    created_by: 'agent',
  })

  if (error) {
    console.warn(`[auto-tasks] anniversary insert falhou (${triggerKey}): ${error.message}`)
    return null
  }
  console.log(`[auto-tasks] aniversario ${yearsPassed} anos criado para ${leadId}`)
  return title
}
