# CRM 2.0 — Design de Reestruturação

**Data:** 2026-04-02
**Decisões aprovadas pelo utilizador**

---

## Visão Geral

CRM imobiliário pessoal para operação solo. O utilizador grava as suas próprias chamadas, faz upload do áudio, e o sistema trata do resto automaticamente: transcrição, criação/actualização de lead, coaching, follow-up inteligente e matching com imóveis.

---

## 1. Fluxo de Chamadas — Áudio → Lead

### Input
- Ficheiro de áudio (MP3, M4A, WAV) exportado do Plaud AI ou qualquer gravador
- Upload manual no CRM — página `/dashboard/leads/upload-call`

### Pipeline (automático após upload)

```
Upload áudio
  → Supabase Storage (guarda ficheiro permanentemente)
  → Whisper API transcreve (~30 seg para 10 min)
  → Lead Agent extrai:
      - Número de telefone (campo obrigatório para dedup)
      - Nome, email, urgência, score, preferências
  → Dedup por phone:
      - Existe lead com esse número → associa upload + actualiza perfil
      - Não existe → cria lead nova
  → Coach Micro analisa transcrição (ver secção 2)
  → Follow-up inteligente avalia urgência (ver secção 3)
  → Notificação: "Lead X actualizada" ou "Nova lead criada"
```

### Schema (nova tabela call_uploads)

```sql
CREATE TABLE call_uploads (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id          UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  lead_id          UUID REFERENCES leads(id) ON DELETE SET NULL,  -- NULL até dedup
  storage_path     TEXT NOT NULL,          -- Supabase Storage path
  audio_duration_s INTEGER,               -- segundos de áudio
  transcript_text  TEXT,                  -- resultado Whisper
  whisper_model    TEXT DEFAULT 'whisper-1',
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','transcribing','analyzing','done','failed')),
  error            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at     TIMESTAMPTZ
);
```

### Custo Whisper
- $0.006/minuto → chamada de 10 min = **$0.06**
- 20 chamadas/mês → **~$1.20/mês**

---

## 2. Coach — Micro + Macro

### Coach Micro (por chamada)

**Trigger:** após cada upload processado com sucesso
**Modelo:** claude-haiku-4-5-20251001 (max_tokens: 800)
**Input:** transcrição da chamada + histórico da lead (últimas 3 interacções)

**Output (aparece no perfil da lead como card "Feedback da Chamada"):**
```json
{
  "pontos_positivos": ["Criaste rapport rapidamente", "Identificaste o orçamento"],
  "a_melhorar": ["Não perguntaste sobre prazo de compra", "Objecção de preço não respondida"],
  "proxima_chamada": "Perguntar sobre situação actual de habitação e prazo",
  "sentimento_lead": "interessado_mas_hesitante"
}
```

**Custo:** ~800 tokens/chamada × $0.0008/1k = **~$0.001/chamada** → $0.40/mês (20 chamadas/sem)

### Coach Macro (pipeline)

**Trigger:** Vercel Cron — semanal (domingo 09:00) + botão manual no dashboard
**Modelo:** claude-haiku-4-5-20251001 (max_tokens: 1500)
**Input:** todas as leads abertas com scores + learnings acumulados + deals ganhos/perdidos

**Output (card "Foco desta semana" no dashboard):**
```json
{
  "prioridades": [
    {
      "lead_name": "João Silva",
      "razao": "Score 78, não contactado há 3 dias, orçamento confirmado",
      "acao": "Ligar hoje — propor visita esta semana"
    }
  ],
  "padrao_semana": "Leads do Facebook convertem em média 40% mais rápido",
  "alerta": "2 leads vão arrefecer se não contactadas até quinta"
}
```

**Custo:** ~2.000 tokens/semana → **~$0.04/mês**

---

## 3. Follow-up Inteligente (por urgência)

### Lógica de activação (NÃO diário para todas as leads)

```
Trigger A: nova lead criada via upload de chamada
Trigger B: score de lead sobe ≥ 10 pontos
Trigger C: Vercel Cron diário — verifica leads com urgency >= 3 sem plano activo

SE urgency >= 3 E sem sequência activa:
  → Gerar sequência de follow-up personalizada
SENÃO:
  → Não fazer nada (evitar ruído)
```

### Sequência gerada (exemplo)

```
Dia 0:  WhatsApp — rascunho gerado pela IA ("Olá João, foi um prazer falar...")
Dia 3:  Chamada — "Confirmar interesse após reflexão"
Dia 7:  Último contacto — "Temos um imóvel novo que pode interessar"
Dia 14: Arquivar se sem resposta
```

Tasks criadas automaticamente no CRM com datas + rascunhos de mensagem.
Sequência pausa automaticamente se lead responder (nova interacção registada).

**Modelo:** claude-haiku-4-5-20251001 (max_tokens: 600)
**Custo:** ~600 tokens/plano → **~$0.003/plano** → $0.12/mês (10 leads/sem)

---

## 4. Agente Orientador (Dashboard Principal)

Card fixo no topo do dashboard — **"O teu foco hoje"**.

### Conteúdo

```
Bom dia, Elsio. Aqui está o teu foco:

🔴 URGENTE (agir hoje)
   João Silva — 5 dias sem contacto, score 78
   → [Ver Lead] [Copiar WhatsApp Draft]

🟡 ESTA SEMANA
   3 leads em reunião pendente
   2 imóveis Remax compatíveis com investidores
   → [Ver Pipeline] [Ver Matches]

💡 COACH
   "Nas últimas chamadas ganhas, a reunião foi
    marcada em menos de 48h. Tenta marcar hoje
    com a Ana M."
```

### Implementação

- **Server Component** — gerado no load do dashboard
- **Cache:** 30 minutos (não recalcula a cada refresh)
- **Modelo:** claude-haiku-4-5-20251001 (max_tokens: 500)
- **Input:** leads urgentes + tasks hoje + último learning do coach macro
- **Custo:** ~800 tokens/sessão × 20 sessões/dia = **~$3.00/mês**

---

## 5. Scraper Remax PT

Já implementado. Mantém-se:
- GitHub Actions cron — `0 7 * * *`
- Playwright headless → POST `/api/opportunities` com dedup por `source_url`
- Matching automático ao criar opportunity

---

## 6. Stack de Automação (sem N8N)

| Tarefa | Ferramenta | Custo |
|---|---|---|
| Crons IA (followup, coach macro, orientador) | Vercel Cron Jobs | Grátis |
| Scraper Remax | GitHub Actions | Grátis |
| Transcrição áudio | OpenAI Whisper API | ~$1.20/mês |
| Modelos IA | Claude Haiku 4.5 | ~$4.50/mês |
| Storage áudio | Supabase Storage | Grátis (< 1GB) |

**Total: ~$5.70/mês**

---

## 7. Ficheiros a Criar/Modificar

| Ficheiro | Acção | Descrição |
|---|---|---|
| `supabase/migrations/010_call_uploads.sql` | CRIAR | Tabela call_uploads |
| `lib/whisper.ts` | CRIAR | Cliente OpenAI Whisper |
| `lib/agents/call-coach-agent.ts` | CRIAR | Coach Micro por chamada |
| `lib/agents/orientator-agent.ts` | CRIAR | Agente orientador dashboard |
| `app/dashboard/leads/upload-call/page.tsx` | CRIAR | Página upload áudio |
| `app/api/calls/upload/route.ts` | CRIAR | POST upload + trigger pipeline |
| `app/api/calls/[id]/status/route.ts` | CRIAR | GET status do processamento |
| `app/api/agents/orientator/route.ts` | CRIAR | GET briefing do dia |
| `app/api/agents/coach-macro/route.ts` | CRIAR | POST coach macro (manual + cron) |
| `app/dashboard/page.tsx` | MODIFICAR | Adicionar card orientador |
| `app/dashboard/leads/[id]/page.tsx` | MODIFICAR | Adicionar card coach micro |
| `vercel.json` | CRIAR | Configurar Vercel Cron Jobs |
| `.github/workflows/remax-scraper.yml` | CRIAR | GitHub Actions scraper |

---

## 8. Ordem de Implementação

1. **Migration 010** — tabela call_uploads
2. **Whisper client** — `lib/whisper.ts`
3. **Upload API** — POST `/api/calls/upload` (storage + transcrição + dedup + lead agent)
4. **Upload UI** — página `/dashboard/leads/upload-call`
5. **Coach Micro** — agent + integração no pipeline de upload
6. **Follow-up inteligente** — lógica de activação por urgência
7. **Agente Orientador** — agent + API + card no dashboard
8. **Coach Macro** — agent + API + Vercel Cron
9. **Vercel Cron Jobs** — `vercel.json`
10. **GitHub Actions** — scraper Remax

---

## 9. Resumo de Custos vs Valor

| | Antes | Depois |
|---|---|---|
| Custo/mês | ~$2-3 | ~$5.70 |
| Trabalho manual | Upload TXT + criar lead + coach manual | Upload áudio (1 passo) |
| Automação | Parcial | Quase total |
| Qualidade transcrição | Plaud (variável) | Whisper (excelente) |
