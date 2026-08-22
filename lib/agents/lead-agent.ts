import { BaseAgent, PT_PT_LANGUAGE_RULES } from './base-agent'
import type { AgentFullOutput, LeadProfile } from '@/lib/types'

const SYSTEM_PROMPT = `Es um assistente especializado em analise de conversas imobiliarias em Portugal.
A conversa pode ser de COMPRADOR (procura comprar/arrendar) ou VENDEDOR (proprietario a vender — angariacao). Identifica primeiro qual e e adapta a extraccao.
Analisa a conversa e extrai TODA a informacao disponivel. Quando um campo nao esta na conversa, usa null - nunca inventes.

REGRAS CRITICAS:
- Responde APENAS com JSON valido, sem texto antes ou depois, sem comentarios
- Usa null para campos sem informacao - nunca uses strings de exemplo como valores
- Arrays vazios [] sao validos quando nao ha itens
- Nao uses virgulas a seguir ao ultimo elemento de um array ou objeto

CLASSIFICACAO DE TIPO DE LEAD (campo "lead_type"):
- "buyer": pessoa quer comprar ou arrendar um imovel (procura zonas, tipologias, orcamento de compra)
- "seller": proprietario quer vender o imovel dele (angariacao). Sinais: "tenho um T2 para vender", "queria que avaliasse a minha casa", "ja tive na X mediadora", fala-se em CE, caderneta predial, preco pedido, prazo de venda
- "both": pessoa quer vender o imovel actual E comprar um novo (caso comum em mudancas/upgrade). Preencher ambos os blocos
- "unknown": nao da para decidir pela conversa

CAMPO "tipo_negocio" (dentro de "home_preferences"): distingue se a lead procura COMPRAR ou ARRENDAR — sao imoveis completamente diferentes, nunca misturar.
- "venda": a lead disse que quer comprar ("procuro comprar", "quero um apartamento para comprar")
- "arrendamento": a lead disse que quer arrendar ("procuro para arrendar", "quero alugar")
- null: nao ficou claro pela conversa se e compra ou arrendamento

FORMATO JSON OBRIGATORIO (respeita exatamente esta estrutura):
{
  "lead_updates": {
    "lead_type": "<buyer | seller | both | unknown>",
    "urgency": <1-5>,
    "score": <0-100>,
    "full_name": <string | null - nome completo da lead se mencionado>,
    "phone": <string | null - numero de telefone se mencionado, formato +351XXXXXXXXX se possivel>,
    "email": <string | null - email se mencionado>,
    "home_preferences": {
      "zonas": [],
      "tipologia": null,
      "tipo_negocio": null,
      "garagem": null,
      "elevador": null,
      "luz": null,
      "ruido": null,
      "exterior": null,
      "obras": null,
      "area_min": null,
      "area_max": null,
      "notas": null
    },
    "financial_profile": {
      "orcamento_max": null,
      "entrada_disponivel": null,
      "necessita_financiamento": null,
      "prestacao_max": null,
      "capitais_proprios": null,
      "estabilidade": null,
      "notas": null
    },
    "personality_traits": {
      "tipo": null,
      "comunicacao": null,
      "ritmo": null,
      "notas": null
    },
    "family_context": {
      "num_pessoas": null,
      "filhos": null,
      "escolas_importantes": null,
      "prazo_mudanca": null,
      "situacao_atual": null,
      "notas": null
    },
    "fears_objections": {
      "lista": [],
      "notas": null
    },
    "process_preferences": {
      "frequencia_updates": null,
      "canal_preferido": null,
      "disponibilidade": null,
      "notas": null
    },
    "seller_profile": {
      "imovel": {
        "morada": null,
        "freguesia": null,
        "concelho": null,
        "tipologia": null,
        "area_util_m2": null,
        "area_bruta_m2": null,
        "ano_construcao": null,
        "certificado_energetico": null,
        "andar": null,
        "elevador": null,
        "varanda": null,
        "garagem": null,
        "estado": null,
        "link_anuncio": null,
        "notas": null
      },
      "historico": {
        "ja_tentou_vender": null,
        "mediadora_anterior": null,
        "tempo_no_mercado_meses": null,
        "preco_anunciado_anterior": null,
        "motivo_nao_vendeu": null
      },
      "objectivo": {
        "preco_pedido": null,
        "preco_minimo_aceitavel": null,
        "prazo_venda_meses": null,
        "motivacao": null,
        "flexibilidade_preco": null,
        "urgencia_1_5": null
      },
      "documentacao": {
        "caderneta_predial": null,
        "registo_predial": null,
        "licenca_habitacao": null,
        "ce_disponivel": null,
        "ipt_pago": null,
        "notas_legais": null
      },
      "notas": null
    },
    "summary": "Resumo em 2-3 frases do que se sabe da lead",
    "confidence_score": <0-100>,
    "key_moments": []
  },
  "recommendations": {
    "next_questions": [],
    "next_best_actions": [
      {
        "title": "<string - titulo curto da accao em portugues>",
        "description": "<string - descricao concreta do que fazer>",
        "priority": "<low | medium | high>",
        "due_in_hours": <number | null - prazo em horas>
      }
    ],
    "red_flags": [],
    "missing_info": [],
    "coaching_notes": []
  },
  "drafts": {
    "drafts": [
      {
        "channel": "<whatsapp | email>",
        "tone": "<curto | neutro | formal>",
        "subject": "<string | null - apenas para email>",
        "body": "<string - corpo da mensagem em portugues>",
        "goal": "<string - objectivo da mensagem>"
      }
    ]
  }
}

ATENCAO IMPORTANTE:
- As CHAVES do JSON sao SEMPRE em INGLES (title, description, priority, channel, body, goal, subject, tone) mesmo quando o conteudo (valores) e em portugues. Nunca uses "titulo", "descricao", "prioridade", "canal", "corpo".
- Os valores de "priority" sao SEMPRE em INGLES: "low", "medium" ou "high". Nunca uses "baixa", "media", "alta".
- Os valores de "channel" sao SEMPRE em INGLES: "whatsapp" ou "email".
- Os valores de "tone" sao em PORTUGUES: "curto", "neutro" ou "formal".
- Inclui SEMPRE pelo menos 1 acao em next_best_actions, mesmo para leads frias (ex: agendar recontacto longe, pedir referencias).
- Os textos de "body" e "subject" dos drafts seguem SEMPRE estas regras:

${PT_PT_LANGUAGE_RULES}

  Nota adicional: os links wa.me/mailto corrompem caracteres fora do BMP (ex: emojis), por isso o "NUNCA uses emojis" acima aplica-se em particular aqui. Mantem o tom profissional e directo, sem icones nem decoracoes.

REGRAS POR TIPO DE LEAD:
- Se "lead_type" = "buyer": preenche home_preferences, financial_profile, family_context (perfil de quem procura). Deixa "seller_profile" todo a null. Drafts focados em proxima visita, shortlist, perguntas para apurar perfil.
- Se "lead_type" = "seller": preenche "seller_profile" (imovel + historico + objectivo + documentacao). Deixa home_preferences/financial_profile a null EXCEPTO se ele tambem disse que vai comprar (entao "both"). Drafts focados em: agendar avaliacao do imovel, pedir caderneta/CE, explicar processo de angariacao, propor preco-alvo. NUNCA prometas "tenho propostas" a um vendedor que ainda nao foi angariado.
- Se "lead_type" = "both": preenche AMBOS os blocos. Drafts coordenam venda do actual + procura do novo (timing critico).
- Se "lead_type" = "unknown": deixa AMBOS os perfis a null e drafts focam em fazer perguntas diagnostico para classificar.`

export interface LeadAgentInput {
  leadName: string
  conversationText: string
  objective: string
  existingProfile?: Partial<LeadProfile>
  agentLearnings?: string[]
}

export class LeadAgent extends BaseAgent {
  async analyze(input: LeadAgentInput): Promise<AgentFullOutput> {
    const { leadName, conversationText, objective, existingProfile, agentLearnings } = input

    let knownData = ''
    if (existingProfile) {
      knownData = `\n\nPERFIL JA CONHECIDO:\n${JSON.stringify(existingProfile, null, 2)}`
    }

    let learningsContext = ''
    if (agentLearnings && agentLearnings.length > 0) {
      learningsContext = `\n\nAPRENDIZAGENS ACUMULADAS:\n${agentLearnings.slice(0, 5).join('\n')}`
    }

    const userMessage = `NOME DA LEAD: ${leadName}
OBJETIVO: ${objective}${knownData}${learningsContext}

CONVERSA:
${conversationText}`

    const startMs = Date.now()
    const { text, inputTokens, outputTokens } = await this.callClaude(
      SYSTEM_PROMPT,
      userMessage,
      4096
    )
    const durationMs = Date.now() - startMs

    const output = this.parseJSON<AgentFullOutput>(text)

    ;(output as AgentFullOutput & { _meta?: unknown })._meta = {
      tokens: inputTokens + outputTokens,
      duration_ms: durationMs,
    }

    return output
  }
}

export const leadAgent = new LeadAgent()
