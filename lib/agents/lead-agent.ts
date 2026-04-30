import { BaseAgent } from './base-agent'
import type { AgentFullOutput, LeadProfile } from '@/lib/types'

const SYSTEM_PROMPT = `Es um assistente especializado em analise de conversas de venda imobiliaria em Portugal.
Analisa a conversa e extrai TODA a informacao disponivel. Quando um campo nao esta na conversa, usa null - nunca inventes.

REGRAS CRITICAS:
- Responde APENAS com JSON valido, sem texto antes ou depois, sem comentarios
- Usa null para campos sem informacao - nunca uses strings de exemplo como valores
- Arrays vazios [] sao validos quando nao ha itens
- Nao uses virgulas a seguir ao ultimo elemento de um array ou objeto

FORMATO JSON OBRIGATORIO (respeita exatamente esta estrutura):
{
  "lead_updates": {
    "urgency": <1-5>,
    "score": <0-100>,
    "full_name": <string | null - nome completo da lead se mencionado>,
    "phone": <string | null - numero de telefone se mencionado, formato +351XXXXXXXXX se possivel>,
    "email": <string | null - email se mencionado>,
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
- Inclui SEMPRE pelo menos 1 acao em next_best_actions, mesmo para leads frias (ex: agendar recontacto longe, pedir referencias).`

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
