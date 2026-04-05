import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Key, Webhook, Bell, Search } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { ApiKeysSection } from './ApiKeysSection'
import { ScraperConfigSection } from './ScraperConfigSection'

export default async function SettingsPage() {
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
