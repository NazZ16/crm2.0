# CRM2.0 — Contexto do Projeto

> Ver a nota-hub na rede: [[CRM2.0 (Projeto)]]
> Ver o vault root: `../../CLAUDE.md`
> Rede neural: `../../Index.md`

## O que é este projeto

CRM imobiliário inteligente para o meu fluxo na [[RE-MAX|RE/MAX]]. Gere leads, conversas, perfis, com análise automática de interações.

**Stack:** Next.js (App Router) + TypeScript + Supabase + Vercel
**Estado:** em desenvolvimento — ver `../../03 Projects/CRM2.0/` para o código

## Prime directive para o Claude neste projeto

> Se uma sessão está a afastar-se de "o Élsio consegue usar isto hoje para gerir um lead real", nomeia-lo:
> **"Isto move o CRM para uso diário, ou é feature que ninguém está a pedir?"**

O risco principal aqui é o [[Pontos Cegos|builder trap]] — construir software bonito que ninguém usa. O projeto só vale se eu o uso todos os dias na frente [[RE-MAX|RE/MAX]].

## O que o Claude deve fazer (ordem de prioridade)

1. **Desbloquear uso diário** — tudo o que me impede de usar isto todos os dias é P0
2. **Garantir dados seguros** — Supabase RLS, auth, validação de input
3. **Manter o código simples** — este CRM é para **um** utilizador (eu) por agora, não sobre-arquitetar
4. **Testes só quando estabilizado** — não perder tempo a testar fluxos que ainda estão a mudar

## Workflow

- **Plan mode** para alterações com 3+ passos ou decisões de arquitetura
- **Subagents** liberalmente para exploração paralela (research, análise, alternativas)
- **Self-improvement:** após qualquer correção do utilizador, registar em `tasks/lessons.md` (a criar quando aparecer a primeira lição)
- **Verificação:** nunca marcar tarefa como feita sem provar que corre — correr `npm run dev`, testar fluxo end-to-end, ver logs

## Regras

- **Nada de features que não tenham um utilizador (eu) a pedir ativamente**
- **Commits pequenos** com mensagem clara
- **Não reescrever código estável** para "ficar mais elegante" — só quando há motivo funcional

## Próximas decisões críticas (a preencher pelo Élsio)

- [ ] Qual é a **funcionalidade-chave** que falta para eu usar diariamente?
- [ ] Status atual: desenvolvimento local / deployado / em uso?
- [ ] Primeira métrica de uso a acompanhar (ex.: leads processadas / semana)?

## Relacionado no vault

- Hub: [[CRM2.0 (Projeto)]]
- Frente de negócio: [[RE-MAX]]
- Objetivo que serve: [[50k 2026]]
- Risco: [[Pontos Cegos]]
