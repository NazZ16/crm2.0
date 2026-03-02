import { BaseAgent } from './base-agent'
import type { AgentFullOutput, LeadProfile } from '@/lib/types'

const SYSTEM_PROMPT = `És um assistente especializado em análise de conversas de venda imobiliária em Portugal.
O teu objetivo é analisar conversas entre um consultor imobiliário e um cliente potencial (lead),
extraindo o máximo de informação útil para o processo de venda.

REGRAS:
- Responde SEMPRE em JSON válido, sem texto antes ou depois
- Sê conservador nas inferências — só extrai o que está claramente expresso ou fortemente implícito
- O score de urgência vai de 1 (sem urgência) a 5 (precisa de imóvel imediatamente)
- O score da lead vai de 0 (muito fria) a 100 (pronta para comprar)
- As dicas de coaching são para o consultor humano melhorar o follow-up
- Os rascunhos de mensagem devem soar naturais em português de Portugal

FORMATO JSON OBRIGATÓRIO:
{
  "lead_updates": {
    "urgency": <1-5>,
    "score": <0-100>,
    "home_preferences": {
      "zonas": ["zona1"],
      "tipologia": "T2" | null,
      "garagem": true | false | null,
      "elevador": true | false | null,
      "luz": "sul" | null,
      "ruido": "silencioso" | null,
      "exterior": true | false | null,
      "obras": true | false | null,
      "area_min": 80 | null,
      "area_max": 120 | null,
      "notas": "texto livre" | null
    },
    "financial_profile": {
      "orcamento_max": 300000 | null,
      "entrada_disponivel": 60000 | null,
      "necessita_financiamento": true | false | null,
      "prestacao_max": 1200 | null,
      "capitais_proprios": null,
      "estabilidade": "estável" | null,
      "margem_seguranca": "tem margem" | null,
      "notas": null
    },
    "personality_traits": {
      "tipo": "analitico" | "emocional" | "pragmatico" | "social" | null,
      "comunicacao": "direto" | "indireto" | "formal" | "informal" | null,
      "ritmo": "rapido" | "lento" | "moderado" | null,
      "notas": null
    },
    "family_context": {
      "num_pessoas": 3 | null,
      "filhos": true | false | null,
      "escolas_importantes": true | false | null,
      "prazo_mudanca": "3 meses" | null,
      "situacao_atual": "a arrendar" | null,
      "notas": null
    },
    "fears_objections": {
      "lista": ["preocupação 1"],
      "notas": null
    },
    "process_preferences": {
      "frequencia_updates": "semanal" | null,
      "canal_preferido": "whatsapp" | null,
      "disponibilidade": "fins de semana" | null,
      "notas": null
    },
    "summary": "Resumo conciso do perfil da lead em 2-3 frases",
    "confidence_score": <0-100>,
    "key_moments": ["momento importante 1", "momento importante 2"]
  },
  "recommendations": {
    "next_questions": ["pergunta 1 por fazer", "pergunta 2"],
    "next_best_actions": [
      {
        "title": "Título da ação",
        "description": "O que fazer e porquê",
        "priority": "high" | "medium" | "low",
        "due_in_hours": 24 | null
      }
    ],
    "red_flags": ["sinal de alerta 1"],
    "missing_info": ["informação em falta 1"],
    "coaching_notes": ["dica para o consultor 1"]
  },
  "drafts": {
    "drafts": [
      {
        "channel": "whatsapp",
        "tone": "curto",
        "subject": null,
        "body": "Mensagem WhatsApp curta e natural",
        "goal": "objetivo da mensagem"
      },
      {
        "channel": "whatsapp",
        "tone": "neutro",
        "subject": null,
        "body": "Mensagem WhatsApp mais detalhada",
        "goal": "objetivo da mensagem"
      },
      {
        "channel": "email",
        "tone": "formal",
        "subject": "Assunto do email",
        "body": "Corpo do email formal",
        "goal": "objetivo da mensagem"
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
      learningsContext = `\n\nAPRENDIZAGENS ACUMULADAS (aplica quando relevante):\n${agentLearnings.slice(0, 5).join('\n')}`
    }

    const userMessage = `NOME DA LEAD: ${leadName}
OBJETIVO DA ANÁLISE: ${objective}${knownData}${learningsContext}

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

    // Attach metadata for logging
    ;(output as AgentFullOutput & { _meta?: unknown })._meta = {
      tokens: inputTokens + outputTokens,
      duration_ms: durationMs,
    }

    return output
  }
}

export const leadAgent = new LeadAgent()
