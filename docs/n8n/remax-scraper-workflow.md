# N8N Workflow — Remax Scraper Diário

## Visão Geral

Schedule diário às 07:00 → executa o scraper Python → importa novos imóveis Remax → matching automático dispara para cada novo imóvel.

## Configuração

### Schedule
- **Cron:** `0 7 * * *` (todos os dias às 07:00)

### Variáveis de ambiente no servidor N8N
```
CRM_API_URL=https://your-crm.vercel.app/api/opportunities
SCRAPER_API_KEY=crm_xxxx   # gerada em Dashboard → Definições → API Keys
REMAX_ZONES=Lisboa,Porto,Cascais,Sintra,Oeiras
REMAX_MAX_PRICE=800000
```

> A equipa é identificada automaticamente pela API key — não é necessário configurar SCRAPER_TEAM_ID.

## Nodes do Workflow

### 1. Schedule Trigger
- Tipo: `n8n-nodes-base.scheduleTrigger`
- Cron: `0 7 * * *`

### 2. Execute Command
- Tipo: `n8n-nodes-base.executeCommand`
- Comando: `cd /path/to/scrapers && python remax_scraper.py`
- Requer: Python instalado no servidor N8N, `playwright install chromium` já executado

### 3. IF — verificar exitCode
- Condição: `{{ $json.exitCode }} == 0`
- Branch TRUE: sucesso (termina)
- Branch FALSE: envia notificação de erro

### 4. (Opcional) Notify on Error
- Tipo: `n8n-nodes-base.slack` ou email
- Mensagem: `"Scraper Remax falhou: {{ $json.stderr }}"`

## Fluxo de Dados

```
N8N Schedule (07:00)
  → executa remax_scraper.py
    → Playwright abre remax.pt/imoveis
    → extrai até 50 listings
    → para cada listing:
        POST /api/opportunities (com X-N8N-Signature)
        → se novo: INSERT + trigger /api/agents/matching (async)
        → se existente: UPDATE asking_price
```

## Alternativa sem Execute Command (N8N Cloud)

Se o N8N Cloud não permitir execução de comandos, usar o workflow em dois passos:

1. **HTTP Request** para um webhook do próprio CRM que despoleta o scraper
2. Ou usar o **Code node** do N8N com fetch para cada URL Remax directamente (sem Playwright — apenas para sites sem JS heavy)

## Manutenção

Os seletores CSS do Remax (`[data-testid="property-card"]`, etc.) podem mudar com redesigns. Testar manualmente o scraper após qualquer mudança de layout no site.
