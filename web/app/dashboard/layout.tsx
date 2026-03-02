import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Sidebar } from '@/components/layout/Sidebar'

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
      <Sidebar
        userEmail={userEmail}
        userName={userName}
        teamName={teamName}
      />
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  )
}
