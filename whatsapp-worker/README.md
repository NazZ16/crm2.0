# whatsapp-worker

Worker Baileys (não-oficial) que liga ao WhatsApp do número profissional e encaminha
mensagens de texto recebidas para o CRM (`/api/whatsapp/baileys-ingest`). Leitura apenas —
nunca envia mensagens.

Corre como processo sempre ligado, à parte do Next.js (que é serverless no Vercel e não
consegue manter isto). Pensado para deploy na Railway.

## Testar localmente

```bash
cd whatsapp-worker
npm install
CRM_INGEST_URL=http://localhost:3000/api/whatsapp/baileys-ingest \
CRM_INGEST_SECRET=<mesmo valor de WHATSAPP_BAILEYS_INGEST_SECRET no .env.local> \
AUTH_DIR=./data/auth \
PORT=3001 \
npm start
```

Abre `http://localhost:3001/qr`, scaneia com o WhatsApp (Definições → Dispositivos ligados →
Ligar dispositivo), e confirma em `http://localhost:3001/health` que o estado passa a
`connected`.

## Deploy na Railway

1. Criar um novo serviço na Railway a partir deste repositório GitHub, com **Root Directory**
   definido como `whatsapp-worker`.
2. Adicionar um **Volume** montado em `/data` (Settings → Volumes) — sem isto, a sessão perde-se
   a cada reinício e tens de re-scanear o QR sempre.
3. Definir as variáveis de ambiente do serviço:
   - `CRM_INGEST_URL` = `https://crm20-two.vercel.app/api/whatsapp/baileys-ingest`
   - `CRM_INGEST_SECRET` = o mesmo valor de `WHATSAPP_BAILEYS_INGEST_SECRET` configurado no
     Vercel
4. Deploy. Abrir o URL público do serviço em `/qr` (ex.:
   `https://<o-teu-servico>.up.railway.app/qr`) e scanear com o telemóvel profissional.
5. Confirmar em `/health` que aparece `{"status":"connected"}`.
6. Testar: pedir a alguém para mandar uma mensagem de WhatsApp real e confirmar que aparece a
   lead/interação no CRM.

## Se a sessão terminar (logged out)

Os logs do serviço mostram `sessão terminada (logged out)`. Apaga o conteúdo do Volume `/data`
na Railway e volta a `/qr` para re-parear.
