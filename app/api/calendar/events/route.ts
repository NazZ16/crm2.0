// /api/calendar/events
// Devolve os eventos do utilizador para um intervalo. Default = hoje.

import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { listEvents, listTodaysEvents } from '@/lib/google-calendar'

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })

  const { data: member } = await supabase
    .from('team_members')
    .select('team_id')
    .eq('user_id', user.id)
    .single()
  if (!member) return NextResponse.json({ error: 'Sem permissao' }, { status: 403 })

  const url = new URL(request.url)
  const range = url.searchParams.get('range') ?? 'today'

  try {
    if (range === 'today') {
      const events = await listTodaysEvents(member.team_id)
      return NextResponse.json({ events })
    }

    const timeMin = url.searchParams.get('timeMin')
    const timeMax = url.searchParams.get('timeMax')
    if (!timeMin || !timeMax) {
      return NextResponse.json({ error: 'timeMin e timeMax necessarios para range=custom' }, { status: 400 })
    }
    const events = await listEvents(member.team_id, timeMin, timeMax)
    return NextResponse.json({ events })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'erro desconhecido'
    return NextResponse.json({ error: msg, events: [] }, { status: 500 })
  }
}
