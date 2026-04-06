import { BaseAgent } from './base-agent'
import type { AgentFullOutput, LeadProfile } from '@/lib/types'

const SYSTEM_PROMPT = `És um assistente especializado em análise de conversas de venda imobiliária em Portugal.
Analisa a conversa e extrai TODA a informação disponível. Quando um campo não está na conversa, usa null — nunca inventes.

REGRAS CRÍTICAS:
- Responde APENAS com JSON válido, sem texto antes ou depois, sem comentários
- Usa null para campos sem informação — nunca uses strings de exemplo como valores
- Arrays vazios [] são válidos quando não há itens
- Não uses vírgulas a seguir ao último elemento de um array ou objeto

FORMATO JSON OBRIGATÓRIO (respeita exatamente esta estrutura):
{
  "lead_updates": {
    "urgency": <1-5>,
    "score": <0-100>,
    "home_preferences": {
      "zonas": [],
      "tipologia": null,
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
    "summary": "Resumo em 2-3 frases do que se sabe da lead",
    "confidence_score": <0-100>,
    "key_moments": []
  },
  "recommendations": {
    "next_questions": [],
    "next_best_actions": [],
    "red_flags": [],
    "missing_info": [],
    "coaching_notes": []
  },
  "drafts": {
    "drafts": [
      {
        "channel": "whatsapp",
        "tone": "curto",
        "subject": null,
        "body": "mensagem curta",
        "goal": "objetivo"
      }
    ]
  }
}`

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
      knownData = `\n\nPERFIL JÁ CONHECIDO:\n${JSON.stringify(existingProfile, null, 2)}`
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
