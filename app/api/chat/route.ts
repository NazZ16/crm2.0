import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { chatAgent } from '@/lib/agents/chat-agent'

const HISTORY_LIMIT = 20

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data, error } = await supabase
    .from('chat_messages')
    .select('id, role, content, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })
    .limit(50)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: member } = await supabase
    .from('team_members')
    .select('team_id')
    .eq('user_id', user.id)
    .single()

  if (!member) return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })

  const body = await request.json().catch(() => null)
  const message = typeof body?.message === 'string' ? body.message.trim() : ''
  if (!message) return NextResponse.json({ error: 'Mensagem em falta' }, { status: 400 })

  const { data: historyRows } = await supabase
    .from('chat_messages')
    .select('role, content')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(HISTORY_LIMIT)

  const history = (historyRows ?? []).reverse() as { role: 'user' | 'assistant'; content: string }[]

  let result: { text: string; toolCalls: { name: string; input: unknown }[] }
  try {
    result = await chatAgent.ask(supabase, history, message)
  } catch (err) {
    console.error('[chat] chatAgent.ask error:', err)
    return NextResponse.json({ error: 'Erro ao processar a pergunta' }, { status: 500 })
  }

  const { error: insertError } = await supabase.from('chat_messages').insert([
    { team_id: member.team_id, user_id: user.id, role: 'user', content: message },
    {
      team_id: member.team_id,
      user_id: user.id,
      role: 'assistant',
      content: result.text,
      tool_calls: result.toolCalls.length ? result.toolCalls : null,
    },
  ])
  if (insertError) console.error('[chat] failed to persist messages:', insertError.message)

  return NextResponse.json({ reply: result.text, toolCalls: result.toolCalls })
}
