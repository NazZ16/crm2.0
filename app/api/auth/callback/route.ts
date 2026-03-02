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

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/dashboard'

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      // Após sessão criada, verificar se o utilizador já tem equipa
      const { data: { user } } = await supabase.auth.getUser()

      if (user) {
        const admin = createServiceClient()
        const { data: existingMember } = await admin
          .from('team_members')
          .select('team_id')
          .eq('user_id', user.id)
          .single()

        if (!existingMember) {
          // Criar equipa com o nome guardado nos metadados do utilizador
          const teamName = (user.user_metadata?.team_name as string | undefined)
            ?? `Equipa de ${user.user_metadata?.full_name ?? user.email}`

          const baseSlug = slugify(teamName)
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

          const { data: team, error: teamError } = await admin
            .from('teams')
            .insert({ name: teamName, slug })
            .select()
            .single()

          if (!teamError && team) {
            await admin
              .from('team_members')
              .insert({ team_id: team.id, user_id: user.id, role: 'admin' })
          }
        }
      }

      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`)
}
