import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

async function createTeamForUser(userId: string, userMeta: Record<string, unknown>) {
  try {
    const admin = createServiceClient()

    const { data: existingMember } = await admin
      .from('team_members')
      .select('team_id')
      .eq('user_id', userId)
      .single()

    if (existingMember) return // já tem equipa

    const teamName = (userMeta?.team_name as string | undefined)
      ?? `Equipa de ${(userMeta?.full_name as string | undefined) ?? 'Utilizador'}`

    const baseSlug = slugify(teamName)
    let slug = baseSlug
    for (let i = 0; i < 10; i++) {
      const { data: existing } = await admin
        .from('teams').select('id').eq('slug', slug).single()
      if (!existing) break
      slug = `${baseSlug}-${Math.floor(Math.random() * 9000 + 1000)}`
    }

    const { data: team, error: teamError } = await admin
      .from('teams')
      .insert({ name: teamName, slug })
      .select()
      .single()

    if (teamError) {
      console.error('[callback] Erro ao criar equipa:', teamError.message)
      return
    }

    const { error: memberError } = await admin
      .from('team_members')
      .insert({ team_id: team.id, user_id: userId, role: 'admin' })

    if (memberError) {
      console.error('[callback] Erro ao criar membro:', memberError.message)
      await admin.from('teams').delete().eq('id', team.id)
    }
  } catch (err) {
    console.error('[callback] Excepção na criação de equipa:', err)
  }
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/dashboard'

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`)
  }

  try {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (error) {
      console.error('[callback] Erro ao trocar código:', error.message)
      return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`)
    }

    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      await createTeamForUser(user.id, user.user_metadata ?? {})
    }

    return NextResponse.redirect(`${origin}${next}`)
  } catch (err) {
    console.error('[callback] Excepção inesperada:', err)
    return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`)
  }
}
