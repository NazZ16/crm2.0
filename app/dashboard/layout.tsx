import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Sidebar } from '@/components/layout/Sidebar'
import { MobileNav } from '@/components/layout/MobileNav'
import { NotificationBell } from '@/components/layout/NotificationBell'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Fetch team info
  const { data: memberData } = await supabase
    .from('team_members')
    .select('teams(name)')
    .eq('user_id', user.id)
    .single()

  const teamName = (memberData?.teams as { name?: string } | null)?.name

  const userName = user.user_metadata?.full_name as string | undefined
  const userEmail = user.email

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      {/* Sidebar — só desktop */}
      <div className="hidden md:flex">
        <Sidebar
          userEmail={userEmail}
          userName={userName}
          teamName={teamName}
        />
      </div>

      {/* Coluna direita: conteúdo + barra mobile em fluxo */}
      <div className="flex flex-col flex-1 min-h-0">
        <main className="flex-1 overflow-y-auto">
          <div className="flex justify-end px-4 pt-3 pb-0">
            <NotificationBell />
          </div>
          {children}
        </main>

        {/* Bottom nav dentro do fluxo — não sobrepõe o conteúdo */}
        <MobileNav
          userEmail={userEmail}
          userName={userName}
          teamName={teamName}
        />
      </div>
    </div>
  )
}
