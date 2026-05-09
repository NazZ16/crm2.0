import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Key, Webhook, Bell, Search, Smartphone, Send } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { ApiKeysSection } from './ApiKeysSection'
import { ScraperConfigSection } from './ScraperConfigSection'
import { PwaInstallButton } from '@/components/PwaInstallButton'
import { GoogleCalendarSection } from './GoogleCalendarSection'

function TelegramSetupCard({ siteUrl }: { siteUrl: string }) {
  const isConfigured = Boolean(process.env.TELEGRAM_BOT_TOKEN)
  const webhookUrl = `${siteUrl}/api/telegram/webhook`

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Send size={16} />
          Telegram Bot — Importar Áudio do Plaud
          {isConfigured ? (
            <span className="ml-auto text-xs font-normal text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
              ✓ Configurado
            </span>
          ) : (
            <span className="ml-auto text-xs font-normal text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
              Não configurado
            </span>
          )}
        </CardTitle>
        <CardDescription>
          Envia áudios do Plaud (ou qualquer gravação) via Telegram para processar automaticamente no CRM — transcrição, extração de lead e coaching.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm text-gray-700">
        <ol className="space-y-3 list-decimal list-inside">
          <li>
            <strong>Criar bot:</strong> Abre o Telegram, fala com{' '}
            <code className="bg-gray-100 px-1 rounded">@BotFather</code> e envia{' '}
            <code className="bg-gray-100 px-1 rounded">/newbot</code>. Copia o token.
          </li>
          <li>
            <strong>Variáveis de ambiente</strong> (Vercel → Settings → Environment Variables):
            <div className="mt-2 font-mono text-xs bg-gray-50 p-3 rounded-lg space-y-1">
              <p><span className="text-purple-600">TELEGRAM_BOT_TOKEN</span>=<span className="text-gray-400">token do BotFather</span></p>
              <p><span className="text-purple-600">TELEGRAM_WEBHOOK_SECRET</span>=<span className="text-gray-400">segredo aleatório (openssl rand -hex 32)</span></p>
              <p><span className="text-purple-600">TELEGRAM_ALLOWED_CHAT_IDS</span>=<span className="text-gray-400">o teu chat ID (obtém enviando /start ao bot)</span></p>
              <p><span className="text-purple-600">TELEGRAM_DEFAULT_TEAM_ID</span>=<span className="text-gray-400">UUID da equipa (ver URL do dashboard)</span></p>
              <p><span className="text-purple-600">TELEGRAM_DEFAULT_USER_ID</span>=<span className="text-gray-400">UUID do utilizador no Supabase</span></p>
            </div>
          </li>
          <li>
            <strong>Registar webhook</strong> — executa este comando uma vez após o deploy:
            <div className="mt-2 font-mono text-xs bg-gray-900 text-green-400 p-3 rounded-lg break-all">
              {`curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \\`}
              <br />
              {`  -d "url=${webhookUrl}" \\`}
              <br />
              {`  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>" \\`}
              <br />
              {`  -d "allowed_updates=[\"message\"]"`}
            </div>
          </li>
          <li>
            <strong>Usar:</strong> Envia <code className="bg-gray-100 px-1 rounded">/start</code> ao bot para obter o teu Chat ID. Depois, exporta o áudio do Plaud e partilha-o no Telegram com o bot.
          </li>
        </ol>

        <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-xs text-blue-800">
          <strong>Formatos suportados:</strong> MP3, M4A, WAV (ficheiros) e mensagens de voz OGG.{' '}
          <strong>Tamanho máximo:</strong> 50MB. O Plaud exporta M4A por omissão — é suportado.
        </div>
      </CardContent>
    </Card>
  )
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ google_connected?: string; google_error?: string }>
}) {
  const params = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  let isAdmin = false
  let teamId: string | null = null
  if (user) {
    const { data: member } = await supabase
      .from('team_members')
      .select('role, team_id')
      .eq('user_id', user.id)
      .single()
    isAdmin = member?.role === 'admin'
    teamId = member?.team_id ?? null
  }

  const { data: scraperConfig } = await supabase
    .from('team_scraper_config')
    .select('zones, max_price, typologies, enabled')
    .eq('team_id', teamId ?? '')
    .maybeSingle()

  // Estado da conexao Google
  let googleEmail: string | null = null
  if (teamId) {
    const { data: conn } = await supabase
      .from('team_calendar_connections')
      .select('google_account_email')
      .eq('team_id', teamId)
      .eq('provider', 'google')
      .maybeSingle()
    googleEmail = conn?.google_account_email ?? null
  }

  const googleFlash = params.google_connected
    ? { type: 'success' as const, text: 'Google Calendar ligado com sucesso!' }
    : params.google_error
    ? { type: 'error' as const, text: `Erro: ${params.google_error}` }
    : null

  const defaultScraperConfig = {
    zones: [] as string[],
    max_price: 800000,
    typologies: [] as string[],
    enabled: true,
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Definições</h1>
        <p className="text-sm text-gray-500 mt-0.5">Configuração do CRM, agentes e integrações</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Smartphone size={16} />
            Aplicação Móvel
          </CardTitle>
          <CardDescription>
            Instala o CRM como app no telemóvel para acesso rápido e para poder partilhar ficheiros de áudio diretamente.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PwaInstallButton />
        </CardContent>
      </Card>

      <GoogleCalendarSection connectedEmail={googleEmail} flashMessage={googleFlash} />

      <TelegramSetupCard siteUrl={process.env.NEXT_PUBLIC_SITE_URL ?? ''} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Key size={16} />
            API Keys — Scraper &amp; Integrações Externas
          </CardTitle>
          <CardDescription>
            Gera keys para autenticar o scraper Remax e outras integrações externas.
            Cada equipa gere as suas próprias keys de forma independente.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isAdmin ? (
            <ApiKeysSection isAdmin={isAdmin} />
          ) : (
            <p className="text-sm text-gray-500">Apenas admins podem gerir API keys.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Search size={16} />
            Scraper Remax — Configuração
          </CardTitle>
          <CardDescription>
            Define as zonas, preço máximo e tipologias que o scraper procura diariamente.
            Podes também acionar o scraper manualmente aqui ou a partir do perfil de uma lead.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isAdmin ? (
            <ScraperConfigSection initialConfig={scraperConfig ?? defaultScraperConfig} />
          ) : (
            <div className="text-sm text-gray-500 space-y-1">
              <p>Zonas: {scraperConfig?.zones?.join(', ') || '—'}</p>
              <p>Preço máximo: {scraperConfig?.max_price?.toLocaleString('pt-PT') ?? '—'} €</p>
              <p>Tipologias: {scraperConfig?.typologies?.join(', ') || 'Todas'}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Webhook size={16} />
            N8N — Orquestração de Workflows
          </CardTitle>
          <CardDescription>
            O N8N é configurado via variáveis de ambiente. As workflows estão disponíveis no repositório GitHub.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-gray-600">
          <p>✅ <strong>Morning Briefing</strong> — Cron 7:00 AM dias úteis → POST /api/agents/followup</p>
          <p>✅ <strong>Novo Lead</strong> — Webhook Supabase INSERT leads → POST /api/agents/leads</p>
          <p>✅ <strong>Nova Conversa</strong> — Webhook Supabase INSERT uploads → POST /api/agents/leads</p>
          <p>✅ <strong>Alerta Leads Frias</strong> — Cron Domingo 18:00 → POST /api/agents/followup</p>
          <p>✅ <strong>Sync Marketing</strong> — Cron meia-noite → Meta + Google + TikTok APIs</p>
          <p>✅ <strong>Coach Semanal</strong> — Cron Domingo 9:00 → GET /api/agents/coach?type=weekly</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Key size={16} />
            Variáveis de Ambiente Necessárias
          </CardTitle>
          <CardDescription>Configura estas variáveis no painel do Vercel e no .env.local local.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 font-mono text-xs bg-gray-50 p-4 rounded-lg">
            <p><span className="text-green-600">NEXT_PUBLIC_SUPABASE_URL</span>=https://xxxx.supabase.co</p>
            <p><span className="text-green-600">NEXT_PUBLIC_SUPABASE_ANON_KEY</span>=eyJ...</p>
            <p><span className="text-green-600">SUPABASE_SERVICE_ROLE_KEY</span>=eyJ... <span className="text-gray-400 font-sans">(apenas server)</span></p>
            <p><span className="text-blue-600">ANTHROPIC_API_KEY</span>=sk-ant-... <span className="text-gray-400 font-sans">(Claude Sonnet 4-6)</span></p>
            <p><span className="text-blue-600">OPENAI_API_KEY</span>=sk-... <span className="text-gray-400 font-sans">(Whisper)</span></p>
            <p><span className="text-purple-600">N8N_WEBHOOK_SECRET</span>=segredo-partilhado</p>
            <p><span className="text-purple-600">N8N_BASE_URL</span>=https://n8n.app.n8n.cloud</p>
            <p><span className="text-orange-600">META_ACCESS_TOKEN</span>=... <span className="text-gray-400 font-sans">(Meta Ads API)</span></p>
            <p><span className="text-orange-600">GOOGLE_ADS_DEVELOPER_TOKEN</span>=...</p>
            <p><span className="text-orange-600">TIKTOK_ACCESS_TOKEN</span>=...</p>
            <p className="pt-2 text-gray-400 font-sans"># Telegram Bot (opcional)</p>
            <p><span className="text-purple-600">TELEGRAM_BOT_TOKEN</span>=... <span className="text-gray-400 font-sans">(do @BotFather)</span></p>
            <p><span className="text-purple-600">TELEGRAM_WEBHOOK_SECRET</span>=...</p>
            <p><span className="text-purple-600">TELEGRAM_ALLOWED_CHAT_IDS</span>=...</p>
            <p><span className="text-purple-600">TELEGRAM_DEFAULT_TEAM_ID</span>=...</p>
            <p><span className="text-purple-600">TELEGRAM_DEFAULT_USER_ID</span>=...</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Bell size={16} />
            Notificações
          </CardTitle>
          <CardDescription>Notificações em tempo real via Supabase Realtime</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-gray-500">
            As notificações aparecem instantaneamente no sino via Supabase Realtime. Notificações push e email via Resend estão planeadas para uma fase futura.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
