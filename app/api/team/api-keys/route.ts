import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { generateApiKey, hashApiKey, keyPrefix } from '@/lib/api-keys'

const createSchema = z.object({
  label: z.string().min(1).max(100),
})

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: member } = await supabase
    .from('team_members')
    .select('team_id, role')
    .eq('user_id', user.id)
    .single()

  if (!member || member.role !== 'admin') {
    return NextResponse.json({ error: 'Apenas admins podem gerir API keys' }, { status: 403 })
  }

  const { data, error } = await supabase
    .from('team_api_keys')
    .select('id, label, key_prefix, last_used_at, revoked_at, created_at')
    .eq('team_id', member.team_id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: member } = await supabase
    .from('team_members')
    .select('team_id, role')
    .eq('user_id', user.id)
    .single()

  if (!member || member.role !== 'admin') {
    return NextResponse.json({ error: 'Apenas admins podem criar API keys' }, { status: 403 })
  }

  const body = await request.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const plainKey = generateApiKey()
  const hash = hashApiKey(plainKey)
  const prefix = keyPrefix(plainKey)

  const { data, error } = await supabase
    .from('team_api_keys')
    .insert({
      team_id: member.team_id,
      label: parsed.data.label,
      key_hash: hash,
      key_prefix: prefix,
      created_by: user.id,
    })
    .select('id, label, key_prefix, created_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // key em plaintext devolvida UMA VEZ — nunca mais recuperável
  return NextResponse.json({ ...data, key: plainKey }, { status: 201 })
}
