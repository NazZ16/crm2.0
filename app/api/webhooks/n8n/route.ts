import { createServiceClient } from '@/lib/supabase/server'
import { verifyN8NWebhook } from '@/lib/n8n/client'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const webhookSchema = z.object({
  team_id: z.string().uuid(),
  type: z.enum([
    'morning_briefing',
    'lead_analyzed',
    'conversation_done',
    'cold_alert',
    'marketing_sync',
    'weekly_report',
  ]),
  payload: z.record(z.string(), z.unknown()).optional(),
})

export async function POST(request: Request) {
  // Verify HMAC signature from N8N
  const signature = request.headers.get('x-n8n-signature') ?? ''
  const body = await request.text()

  if (!verifyN8NWebhook(body, signature)) {
    console.warn('[N8N Webhook] Assinatura inválida')
    return NextResponse.json({ error: 'Assinatura inválida' }, { status: 401 })
  }

  let parsed
  try {
    parsed = webhookSchema.parse(JSON.parse(body))
  } catch {
    return NextResponse.json({ error: 'Payload inválido' }, { status: 400 })
  }

  const { team_id, type, payload } = parsed
  const supabase = createServiceClient()

  switch (type) {
    case 'morning_briefing': {
      await supabase.from('notifications').insert({
        team_id,
        type: 'agent_complete',
        title: '☀️ Plano Matinal Pronto',
        body: (payload?.summary as string) ?? 'O teu plano de follow-up para hoje está pronto.',
        link: '/dashboard',
      })
      break
    }

    case 'lead_analyzed': {
      const leadId = payload?.lead_id as string | undefined
      await supabase.from('notifications').insert({
        team_id,
        type: 'agent_complete',
        title: '🤖 Análise de Lead Concluída',
        body: (payload?.summary as string) ?? 'O agente analisou a lead e criou tarefas.',
        link: leadId ? `/dashboard/leads/${leadId}` : '/dashboard/leads',
      })
      break
    }

    case 'cold_alert': {
      const coldCount = payload?.cold_count as number | undefined
      if (coldCount && coldCount > 0) {
        await supabase.from('notifications').insert({
          team_id,
          type: 'cold_lead',
          title: `🧊 ${coldCount} Lead${coldCount > 1 ? 's' : ''} Fria${coldCount > 1 ? 's' : ''} Detectada${coldCount > 1 ? 's' : ''}`,
          body: 'Leads sem contacto há mais de 7 dias. Reativa-as antes de as perder.',
          link: '/dashboard/leads',
        })
      }
      break
    }

    case 'weekly_report': {
      await supabase.from('notifications').insert({
        team_id,
        type: 'tip',
        title: '📊 Relatório Semanal do Coach',
        body: (payload?.summary as string) ?? 'O Coach IA analisou a tua semana e extraiu novas aprendizagens.',
        link: '/dashboard/agents',
      })
      break
    }

    case 'marketing_sync': {
      await supabase.from('notifications').insert({
        team_id,
        type: 'info',
        title: '📈 Dados de Marketing Atualizados',
        body: 'As métricas das campanhas foram atualizadas.',
        link: '/dashboard/marketing',
      })
      break
    }

    default:
      break
  }

  return NextResponse.json({ ok: true })
}
