// whatsapp-worker/index.js — liga ao WhatsApp via Baileys (não-oficial, protocolo
// "WhatsApp Web"/multi-device) e encaminha mensagens de texto e áudio (transcrito no
// backend) recebidas para o CRM.
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

const fs = require('fs')
const path = require('path')
const express = require('express')
const qrcode = require('qrcode')
const pino = require('pino')
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
  DisconnectReason,
} = require('@whiskeysockets/baileys')

// Acima disto o worker so reconhece audio de WhatsApp e descarrega-o — a transcricao
// em si (Whisper) acontece no backend (Vercel), que ja tem OPENAI_API_KEY configurada
// para as chamadas telefonicas (lib/whisper.ts). Evita duplicar a chave/logica aqui.
const MAX_AUDIO_BYTES = 20 * 1024 * 1024

const AUTH_DIR = process.env.AUTH_DIR || '/data/auth'
const CRM_INGEST_URL = process.env.CRM_INGEST_URL
const CRM_INGEST_SECRET = process.env.CRM_INGEST_SECRET
const PORT = process.env.PORT || 3000
const RECONNECT_DELAY_MS = 5000
// Guardado dentro do volume persistente (mesmo pai de AUTH_DIR), para sobreviver a reinícios.
const LID_MAP_PATH = path.join(AUTH_DIR, '..', 'lid-map.json')

if (!CRM_INGEST_URL || !CRM_INGEST_SECRET) {
  console.error('[worker] CRM_INGEST_URL e CRM_INGEST_SECRET são obrigatórios')
  process.exit(1)
}

const logger = pino({ level: 'warn' })

let latestQr = null
let connectionState = 'connecting' // connecting | qr_pending | connected | disconnected

// Cache LID→telefone: quando uma mensagem traz `remoteJidAlt`/`senderPn`, guardamos a
// correspondência para reutilizar em mensagens futuras do mesmo LID que não os tragam — ex.
// mensagens que TU envias (fromMe), que na prática não vêm com esses campos preenchidos,
// mas o LID do chat é sempre o mesmo, e já o vimos resolvido numa mensagem recebida antes.
let lidToPhoneJid = new Map()

function loadLidMap() {
  try {
    const raw = fs.readFileSync(LID_MAP_PATH, 'utf8')
    lidToPhoneJid = new Map(Object.entries(JSON.parse(raw)))
    console.log(`[worker] carregado mapa LID→telefone (${lidToPhoneJid.size} entradas)`)
  } catch {
    lidToPhoneJid = new Map()
  }
}

function saveLidMap() {
  try {
    fs.mkdirSync(path.dirname(LID_MAP_PATH), { recursive: true })
    fs.writeFileSync(LID_MAP_PATH, JSON.stringify(Object.fromEntries(lidToPhoneJid)))
  } catch (err) {
    console.error('[worker] falhou a guardar mapa LID→telefone:', err.message)
  }
}

// A Meta tem vindo a substituir o JID do telefone por um "LID" (Local ID, ex.
// 151088510574694@lid) em cada vez mais conversas, por privacidade — não é um número de
// telefone. Nesses casos o Baileys pode expor o JID do telefone real em `remoteJidAlt` ou em
// `senderPn` (confirmado em produção — inclui o indicativo do país, útil para contactos
// estrangeiros). Nenhum dos dois costuma vir em mensagens `fromMe`, por isso guarda-se a
// correspondência assim que é vista (normalmente numa mensagem recebida) e reutiliza-se depois.
function resolvePhoneJid(msg) {
  const remoteJid = msg.key.remoteJid
  let resolved = null

  if (remoteJid && remoteJid.endsWith('@s.whatsapp.net')) {
    resolved = remoteJid
  } else if (msg.key.remoteJidAlt && msg.key.remoteJidAlt.endsWith('@s.whatsapp.net')) {
    resolved = msg.key.remoteJidAlt
  } else if (msg.key.senderPn && msg.key.senderPn.endsWith('@s.whatsapp.net')) {
    resolved = msg.key.senderPn
  }

  if (resolved) {
    if (remoteJid && remoteJid.endsWith('@lid') && lidToPhoneJid.get(remoteJid) !== resolved) {
      lidToPhoneJid.set(remoteJid, resolved)
      saveLidMap()
    }
    return resolved
  }

  if (remoteJid && lidToPhoneJid.has(remoteJid)) {
    return lidToPhoneJid.get(remoteJid)
  }

  return null
}

// Devolve { text } para mensagens de texto, ou { audioBuffer, mimeType } para audio (voz ou
// ficheiro de audio partilhado) — o backend e que transcreve. `sock` e' necessario porque o
// download pode ter de re-pedir o media ao WhatsApp (URL expirada).
async function extractContent(msg, sock) {
  const message = msg.message
  if (!message) return null
  if (message.conversation) return { text: message.conversation }
  if (message.extendedTextMessage && message.extendedTextMessage.text) {
    return { text: message.extendedTextMessage.text }
  }
  if (message.audioMessage) {
    const { fileLength, mimetype } = message.audioMessage
    if (fileLength && Number(fileLength) > MAX_AUDIO_BYTES) {
      console.warn('[worker] audio demasiado grande, a ignorar transcricao', { fileLength: Number(fileLength) })
      return { text: '[mensagem: audioMessage — demasiado grande para transcrever]' }
    }
    try {
      const audioBuffer = await downloadMediaMessage(
        msg,
        'buffer',
        {},
        { logger, reuploadRequest: sock.updateMediaMessage.bind(sock) }
      )
      return { audioBuffer, mimeType: mimetype || 'audio/ogg' }
    } catch (err) {
      console.error('[worker] falhou a descarregar audio:', err.message)
      return { text: '[mensagem: audioMessage — falhou download]' }
    }
  }
  const type = Object.keys(message)[0]
  return type ? { text: `[mensagem: ${type}]` } : null
}

async function forwardMessage({ phone, text, audioBuffer, mimeType, profileName, occurredAt, fromMe }) {
  const body = audioBuffer
    ? { phone, audioBase64: audioBuffer.toString('base64'), audioMimeType: mimeType, profileName, occurredAt, fromMe }
    : { phone, text, profileName, occurredAt, fromMe }

  try {
    const res = await fetch(CRM_INGEST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-ingest-secret': CRM_INGEST_SECRET },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const responseBody = await res.text()
      console.error('[worker] CRM recusou a mensagem', res.status, responseBody)
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
    // 'notify' = mensagem nova em tempo real (normalmente as que a lead envia).
    // 'append' = sincronização vinda de outro dispositivo — é assim que chegam as mensagens
    // que TU envias pelo telemóvel (o worker não é a origem, só está a ser posto a par).
    // Ignoramos outros tipos (ex. sync inicial de histórico) para não trazer conversas antigas.
    if (type !== 'notify' && type !== 'append') return

    for (const msg of messages) {
      try {
        const fromMe = Boolean(msg.key.fromMe)
        const remoteJid = msg.key.remoteJid
        if (!remoteJid || remoteJid.endsWith('@g.us') || remoteJid === 'status@broadcast') continue

        const content = await extractContent(msg, sock)
        if (!content) continue

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
          text: content.text,
          audioBuffer: content.audioBuffer,
          mimeType: content.mimeType,
          // pushName é o nome de quem enviou — se fomos nós, isso é o NOSSO nome, não o da
          // lead, por isso só se passa quando a mensagem é mesmo recebida.
          profileName: fromMe ? undefined : (msg.pushName || undefined),
          occurredAt,
          fromMe,
        })
        console.log('[worker] mensagem encaminhada', { phone, fromMe, audio: Boolean(content.audioBuffer) })
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

loadLidMap()

startSock().catch((err) => {
  console.error('[worker] falhou a arrancar:', err)
  process.exit(1)
})
