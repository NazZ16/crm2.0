import { BaseAgent } from './base-agent'
import type { AgentLearning } from '@/lib/types'

const EXTRACT_SYSTEM_PROMPT = `És um coach de vendas imobiliárias em Portugal especializado em análise de padrões.
Analisa os dados de deals ganhos e perdidos e extrai aprendizagens accionáveis.

REGRAS:
- Identifica padrões claros com evidência suficiente (mínimo 3 casos similares)
- Classifica cada aprendizagem por tipo
- Atribui um nível de confiança realista (0.0 a 1.0)
- Responde SEMPRE em JSON válido

FORMATO JSON:
{
  "learnings": [
    {
      "learning_type": "conversion_pattern" | "objection" | "timing" | "source" | "behavior",
      "content": "Descrição clara e accionável da aprendizagem",
      "evidence_json": { "sample_size": 5, "win_rate": 0.8, "examples": [] },
      "confidence": 0.75,
      "tags": ["facebook", "t3", "financiamento"]
    }
  ]
}`

const TIPS_SYSTEM_PROMPT = `És um coach de vendas imobiliárias em Portugal.
Com base nas aprendizagens acumuladas e no pipeline atual, dá dicas concretas e personalizadas.

REGRAS:
- Máximo 3 dicas por dia, focadas e accionáveis
- Baseadas em padrões reais do histórico do utilizador
- Responde em texto direto (não JSON)`

export interface DealAnalysis {
  id: string
  lead_name: string
  status: 'won' | 'lost'
  source: string | null
  score_at_close: number
  urgency: number
  days_to_close: number
  interactions_count: number
  key_factors: string[]
}

export interface CoachLearningsOutput {
  learnings: Omit<AgentLearning, 'id' | 'team_id' | 'created_at' | 'updated_at' | 'times_confirmed'>[]
}

export class CoachAgent extends BaseAgent {
  async extractLearnings(deals: DealAnalysis[], existingLearnings: string[]): Promise<CoachLearningsOutput> {
    if (deals.length < 3) {
      return { learnings: [] }
    }

    const userMessage = `HISTÓRICO DE DEALS (${deals.length} total):
${JSON.stringify(deals, null, 2)}

APRENDIZAGENS JÁ CONHECIDAS (não duplicar):
${existingLearnings.slice(0, 10).join('\n') || 'Nenhuma ainda'}

Extrai novas aprendizagens que ainda não estão na lista existente.`

    const { text } = await this.callClaude(EXTRACT_SYSTEM_PROMPT, userMessage, 2048)
    return this.parseJSON<CoachLearningsOutput>(text)
  }

  async getDailyTips(
    learnings: string[],
    currentPipelineJson: string
  ): Promise<string> {
    const userMessage = `APRENDIZAGENS ACUMULADAS:
${learnings.slice(0, 8).join('\n')}

PIPELINE ATUAL:
${currentPipelineJson}

Dá 3 dicas concretas para hoje com base nestes dados.`

    const { text } = await this.callClaude(TIPS_SYSTEM_PROMPT, userMessage, 512)
    return text.trim()
  }
}

export const coachAgent = new CoachAgent()
