# Lições

## 2026-08-18 — Idioma dos agentes: PT-PT explícito, não basta dizer "português europeu"
Instruir um agente com "português europeu (Portugal)" no system prompt não é suficiente — o modelo pode
ainda deslizar para português do Brasil (ex: "você", gerúndio "fazendo" em vez de "a fazer"). Correcção do
Élsio em `lib/agents/re-engagement-agent.ts`: tornar a regra explícita e concreta (tratamento por "tu"/nome
em vez de "você", "a + infinitivo" em vez de gerúndio, vocabulário de Portugal, evitar expressões brasileiras).
Aplicar o mesmo nível de detalhe em qualquer agente novo que gere texto em português para o utilizador final.

## 2026-08-18 — Registo demasiado escrito/formal em mensagens de WhatsApp
O agente produzia frases correctas em PT-PT mas com registo demasiado escrito (ex: oração reduzida de
particípio "Passado um tempo desde a última conversa e gostava de perceber..." — gramaticalmente válida
mas artificial numa mensagem de WhatsApp). Correcção do Élsio: pedir explicitamente registo de fala
natural, frases curtas, e evitar abrir frases com orações reduzidas de particípio. Também encontrei e
corrigi um bug meu — a assinatura estava sem acento ("Elsio" em vez de "Élsio") porque eu tinha escrito
o system prompt sem o acento.
