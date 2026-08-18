// whatsapp-worker/index.js — liga ao WhatsApp via Baileys (não-oficial, protocolo
// "WhatsApp Web"/multi-device) e encaminha mensagens de texto recebidas para o CRM.
//
// Leitura apenas: nunca envia mensagens. Corre como processo sempre ligado (não é
// serverless) — deployado à parte do Next.js, ex. na Railway.
//
// Variáveis de ambiente obrigatórias:
//   CRM_INGEST_URL    — ex. https://crm20-two.vercel.app/api/whatsapp/baileys-ingest
//   CRM_INGEST_SECRET — mesmo valor de WHATSAPP_BAILEYS_INGEST_SECRET no Vercel
// Opcionais:
//   AUTH_DIR — pasta onde a sessão fica guardada (default /data/auth — monta um volume
//              persistente aqui, senão perdes a sessão e tens de re-scanear o QR a cada deploy)
//   PORT     — porta do servidor HTTP (/qr e /health), default 3000

const express = require('express')
const qrcode = require('qrcode')
const pino = require('pino')
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
} = require('@whiskeysockets/baileys')

const AUTH_DIR = process.env.AUTH_DIR || '/data/auth'
const CRM_INGEST_URL = process.env.CRM_INGEST_URL
const CRM_INGEST_SECRET = process.env.CRM_INGEST_SECRET
const PORT = process.env.PORT || 3000
const RECONNECT_DELAY_MS = 5000

if (!CRM_INGEST_URL || !CRM_INGEST_SECRET) {
  console.error('[worker] CRM_INGEST_URL e CRM_INGEST_SECRET são obrigatórios')
  process.exit(1)
}

const logger = pino({ level: 'warn' })

let latestQr = null
let connectionState = 'connecting' // connecting | qr_pending | connected | disconnected

// A Meta tem vindo a substituir o JID do telefone por um "LID" (Local ID, ex.
// 151088510574694@lid) em cada vez mais conversas, por privacidade — não é um número de
// telefone. Nesses casos o Baileys expõe o JID do telefone real em `remoteJidAlt`. Se não
// vier, não há forma fiável de descobrir o número — ignora-se a mensagem em vez de guardar
// lixo como se fosse um telefone.
function resolvePhoneJid(msg) {
  const remoteJid = msg.key.remoteJid
  if (remoteJid && remoteJid.endsWith('@s.whatsapp.net')) return remoteJid
  if (msg.key.remoteJidAlt && msg.key.remoteJidAlt.endsWith('@s.whatsapp.net')) {
    return msg.key.remoteJidAlt
  }
  return null
}

function extractText(message) {
  if (!message) return null
  if (message.conversation) return message.conversation
  if (message.extendedTextMessage && message.extendedTextMessage.text) {
    return message.extendedTextMessage.text
  }
  const type = Object.keys(message)[0]
  return type ? `[mensagem: ${type}]` : null
}

async function forwardMessage({ phone, text, profileName, occurredAt }) {
  try {
    const res = await fetch(CRM_INGEST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-ingest-secret': CRM_INGEST_SECRET },
      body: JSON.stringify({ phone, text, profileName, occurredAt }),
    })
    if (!res.ok) {
      const body = await res.text()
      console.error('[worker] CRM recusou a mensagem', res.status, body)
    }
  } catch (err) {
    console.error('[worker] falhou a enviar mensagem ao CRM:', err.message)
  }
}

async function startSock() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR)
  const { version } = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    version,
    auth: state,
    logger,
    syncFullHistory: false,
    markOnlineOnConnect: false,
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update

    if (qr) {
      latestQr = qr
      connectionState = 'qr_pending'
      console.log('[worker] novo QR gerado — abre /qr para scanear')
    }

    if (connection === 'open') {
      connectionState = 'connected'
      latestQr = null
      console.log('[worker] ligado ao WhatsApp')
    }

    if (connection === 'close') {
      connectionState = 'disconnected'
      const statusCode = lastDisconnect && lastDisconnect.error && lastDisconnect.error.output
        ? lastDisconnect.error.output.statusCode
        : undefined
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut

      console.log('[worker] ligação fechada', { statusCode, shouldReconnect })

      if (shouldReconnect) {
        setTimeout(() => {
          startSock().catch((err) => console.error('[worker] falhou a reconectar:', err))
        }, RECONNECT_DELAY_MS)
      } else {
        console.error(
          '[worker] sessão terminada (logged out) — apaga o volume ' +
            AUTH_DIR +
            ' e re-scaneia o QR em /qr'
        )
      }
    }
  })

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return

    for (const msg of messages) {
      try {
        if (msg.key.fromMe) continue
        const remoteJid = msg.key.remoteJid
        if (!remoteJid || remoteJid.endsWith('@g.us') || remoteJid === 'status@broadcast') continue

        const text = extractText(msg.message)
        if (!text) continue

        const phoneJid = resolvePhoneJid(msg)
        if (!phoneJid) {
          console.warn(
            '[worker] JID sem número de telefone real (LID sem remoteJidAlt), a ignorar — ' +
              'key completa: ' + JSON.stringify(msg.key) +
              ' | campos da mensagem: ' + JSON.stringify(Object.keys(msg)) +
              ' | pushName: ' + JSON.stringify(msg.pushName ?? null) +
              ' | verifiedBizName: ' + JSON.stringify(msg.verifiedBizName ?? null)
          )
          continue
        }
        const phone = phoneJid.replace('@s.whatsapp.net', '')
        const occurredAt = msg.messageTimestamp
          ? new Date(Number(msg.messageTimestamp) * 1000).toISOString()
          : new Date().toISOString()

        await forwardMessage({
          phone,
          text,
          profileName: msg.pushName || undefined,
          occurredAt,
        })
        console.log('[worker] mensagem encaminhada', { phone })
      } catch (err) {
        console.error('[worker] falhou a processar mensagem recebida:', err.message)
      }
    }
  })
}

const app = express()

app.get('/health', (req, res) => {
  res.json({ status: connectionState })
})

app.get('/qr', async (req, res) => {
  if (connectionState === 'connected') {
    res.send('<h1>Já ligado ao WhatsApp ✅</h1>')
    return
  }
  if (!latestQr) {
    res.send('<h1>A gerar QR code...</h1><meta http-equiv="refresh" content="3">')
    return
  }
  const dataUrl = await qrcode.toDataURL(latestQr)
  res.send(
    '<html><body style="display:flex;flex-direction:column;align-items:center;' +
      'font-family:sans-serif;margin-top:40px">' +
      '<h1>Scaneia com o WhatsApp</h1>' +
      '<p>Definições → Dispositivos ligados → Ligar dispositivo</p>' +
      '<img src="' + dataUrl + '" width="300" height="300" />' +
      '<meta http-equiv="refresh" content="20">' +
      '</body></html>'
  )
})

app.listen(PORT, () => console.log(`[worker] servidor HTTP na porta ${PORT}`))

startSock().catch((err) => {
  console.error('[worker] falhou a arrancar:', err)
  process.exit(1)
})
