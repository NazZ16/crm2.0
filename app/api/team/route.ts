import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const createTeamSchema = z.object({
  team_name: z.string().min(1).max(200),
})

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

export async function POST(request: Request) {
  // Verificar autenticação com client normal (RLS)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  // Operações de escrita com service role (bypassa RLS para bootstrap da equipa)
  const { createServiceClient } = await import('@/lib/supabase/server')
  const admin = createServiceClient()

  // Check if user already has a team
  const { data: existingMember } = await admin
    .from('team_members')
    .select('team_id')
    .eq('user_id', user.id)
    .single()

  if (existingMember) {
    return NextResponse.json({ error: 'Utilizador já pertence a uma equipa' }, { status: 409 })
  }

  const body = await request.json()
  const parsed = createTeamSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Nome da equipa inválido' }, { status: 400 })
  }

  const baseSlug = slugify(parsed.data.team_name)

  // Ensure slug uniqueness with suffix
  let slug = baseSlug
  let attempt = 0
  while (attempt < 10) {
    const { data: existing } = await admin
      .from('teams')
      .select('id')
      .eq('slug', slug)
      .single()

    if (!existing) break
    attempt++
    slug = `${baseSlug}-${Math.floor(Math.random() * 9000 + 1000)}`
  }

  // Create team
  const { data: team, error: teamError } = await admin
    .from('teams')
    .insert({ name: parsed.data.team_name, slug })
    .select()
    .single()

  if (teamError) return NextResponse.json({ error: teamError.message }, { status: 500 })

  // Add user as admin
  const { error: memberError } = await admin
    .from('team_members')
    .insert({ team_id: team.id, user_id: user.id, role: 'admin' })

  if (memberError) {
    await admin.from('teams').delete().eq('id', team.id)
    return NextResponse.json({ error: memberError.message }, { status: 500 })
  }

  return NextResponse.json({ team_id: team.id, slug: team.slug }, { status: 201 })
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: member } = await supabase
    .from('team_members')
    .select('team_id, role, teams(id, name, slug, plan)')
    .eq('user_id', user.id)
    .single()

  if (!member) return NextResponse.json({ error: 'Equipa não encontrada' }, { status: 404 })

  // Get all team members
  const { data: members } = await supabase
    .from('team_members')
    .select('id, user_id, role, joined_at')
    .eq('team_id', member.team_id)

  return NextResponse.json({ team: member.teams, members, your_role: member.role })
}
