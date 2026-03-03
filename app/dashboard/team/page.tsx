import { createClient, createServiceClient } from '@/lib/supabase/server'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Users, Crown, Shield, Eye, CalendarDays, Building2, Link2 } from 'lucide-react'
import type { TeamRole } from '@/lib/types'
import { formatDate } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const ROLE_CONFIG: Record<TeamRole, { label: string; color: string; icon: React.ElementType }> = {
  admin: { label: 'Admin', color: 'bg-amber-100 text-amber-800', icon: Crown },
  agent: { label: 'Agente', color: 'bg-blue-100 text-blue-700', icon: Shield },
  viewer: { label: 'Visualizador', color: 'bg-gray-100 text-gray-600', icon: Eye },
}

export default async function TeamPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  // Get team + current user role
  const { data: myMember } = await supabase
    .from('team_members')
    .select('team_id, role, joined_at, teams(id, name, slug, plan)')
    .eq('user_id', user.id)
    .single()

  if (!myMember) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <p className="text-sm text-gray-500">Não pertences a nenhuma equipa.</p>
      </div>
    )
  }

  type TeamRow = { id: string; name: string; slug: string; plan: string }
  const teamsRaw = myMember.teams as unknown as TeamRow | TeamRow[] | null
  const team = Array.isArray(teamsRaw) ? (teamsRaw[0] ?? null) : teamsRaw
  const myRole = myMember.role as TeamRole

  // Get all team members
  const { data: membersRaw } = await supabase
    .from('team_members')
    .select('id, user_id, role, joined_at')
    .eq('team_id', myMember.team_id)
    .order('joined_at', { ascending: true })

  const members = membersRaw ?? []

  // Get user details (email + full_name) via admin client
  const admin = createServiceClient()
  const { data: { users: authUsers } } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 100,
  })
  const authMap = new Map(authUsers.map((u) => [u.id, u]))

  const registerUrl = `${process.env.NEXT_PUBLIC_SITE_URL ?? ''}/register`

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Equipa</h1>
        <p className="text-sm text-gray-500 mt-0.5">Gestão de membros e funções da equipa</p>
      </div>

      {/* Team info */}
      {team && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 size={16} />
              {team.name}
            </CardTitle>
            <CardDescription className="flex items-center gap-2">
              <span className="font-mono text-xs text-gray-400">/{team.slug}</span>
              <Badge variant="outline" className="text-xs capitalize">{team.plan}</Badge>
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-gray-600">
            <span className="font-medium">{members.length}</span> {members.length === 1 ? 'membro' : 'membros'} na equipa
          </CardContent>
        </Card>
      )}

      {/* Members list */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Users size={16} />
            Membros
          </CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-gray-100">
          {members.map((member) => {
            const authUser = authMap.get(member.user_id)
            const email = authUser?.email ?? `Utilizador ${member.user_id.slice(0, 8)}`
            const name = (authUser?.user_metadata?.full_name as string | undefined) ?? null
            const initials = name
              ? name.split(' ').slice(0, 2).map((n: string) => n[0]).join('').toUpperCase()
              : email[0]?.toUpperCase() ?? 'U'
            const role = member.role as TeamRole
            const { label, color, icon: RoleIcon } = ROLE_CONFIG[role] ?? ROLE_CONFIG.viewer
            const isCurrentUser = member.user_id === user.id

            return (
              <div key={member.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                {/* Avatar */}
                <Avatar className="h-9 w-9 flex-shrink-0">
                  <AvatarFallback className="text-xs bg-teal-100 text-teal-700">
                    {initials}
                  </AvatarFallback>
                </Avatar>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-900 truncate">
                      {name ?? email}
                    </span>
                    {isCurrentUser && (
                      <span className="text-xs text-gray-400">(tu)</span>
                    )}
                  </div>
                  {name && (
                    <div className="text-xs text-gray-500 truncate">{email}</div>
                  )}
                </div>

                {/* Role badge */}
                <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${color}`}>
                  <RoleIcon size={11} />
                  {label}
                </div>

                {/* Joined date */}
                <div className="hidden sm:flex items-center gap-1 text-xs text-gray-400 flex-shrink-0">
                  <CalendarDays size={11} />
                  {formatDate(member.joined_at)}
                </div>
              </div>
            )
          })}
        </CardContent>
      </Card>

      {/* Invite section */}
      {myRole === 'admin' && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Link2 size={16} />
              Convidar Membro
            </CardTitle>
            <CardDescription>
              Partilha o link de registo. Após o registo, o novo membro cria a sua própria equipa
              e o administrador pode gerir o acesso manualmente.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
              <code className="text-sm text-gray-700 flex-1 select-all">{registerUrl}</code>
            </div>
            <p className="text-xs text-gray-400 mt-2">
              Funcionalidade de convite por email será adicionada em breve.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Role legend */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-gray-500 font-medium">Funções e permissões</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {(Object.entries(ROLE_CONFIG) as [TeamRole, typeof ROLE_CONFIG[TeamRole]][]).map(([role, { label, color, icon: RoleIcon }]) => (
            <div key={role} className="flex items-start gap-3">
              <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${color} flex-shrink-0 mt-0.5`}>
                <RoleIcon size={11} />
                {label}
              </div>
              <p className="text-xs text-gray-500">
                {role === 'admin' && 'Acesso total — pode gerir leads, investidores, campanhas e membros da equipa.'}
                {role === 'agent' && 'Pode criar e editar leads, registar interações e gerir tarefas.'}
                {role === 'viewer' && 'Apenas leitura — não pode criar nem editar registos.'}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
