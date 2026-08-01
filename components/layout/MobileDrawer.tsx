'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard,
  Users,
  Kanban,
  BarChart3,
  Megaphone,
  Bot,
  Settings,
  LogOut,
  Building2,
  Building,
  Home,
  GitMerge,
  UsersRound,
  X,
  PenSquare,
  Contact,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { useEffect } from 'react'

const ALL_NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { href: '/dashboard/leads', label: 'Leads', icon: Users },
  { href: '/dashboard/pipeline', label: 'Pipeline', icon: Kanban },
  { href: '/dashboard/partners', label: 'Parceiros', icon: Contact },
  { href: '/dashboard/investors', label: 'Investidores', icon: Building2 },
  { href: '/dashboard/opportunities', label: 'Oportunidades', icon: Home },
  { href: '/dashboard/listings', label: 'Imóveis', icon: Building },
  { href: '/dashboard/matching', label: 'Matches', icon: GitMerge },
  { href: '/dashboard/marketing', label: 'Marketing', icon: Megaphone },
  { href: '/dashboard/content', label: 'Conteúdo', icon: PenSquare },
  { href: '/dashboard/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/dashboard/agents', label: 'Agentes IA', icon: Bot },
  { href: '/dashboard/team', label: 'Equipa', icon: UsersRound },
  { href: '/dashboard/settings', label: 'Definições', icon: Settings },
]

interface MobileDrawerProps {
  open: boolean
  onClose: () => void
  userEmail?: string
  userName?: string
  teamName?: string
}

export function MobileDrawer({ open, onClose, userEmail, userName, teamName }: MobileDrawerProps) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()

  // Fechar ao mudar de página
  useEffect(() => {
    if (open) onClose()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  // Fechar com Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  async function handleLogout() {
    await supabase.auth.signOut()
    toast.success('Sessão terminada')
    router.push('/login')
    router.refresh()
  }

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname.startsWith(href)

  const initials = userName
    ? userName.split(' ').slice(0, 2).map((n) => n[0]).join('').toUpperCase()
    : userEmail?.[0]?.toUpperCase() ?? 'U'

  if (!open) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/60 md:hidden"
        onClick={onClose}
        aria-hidden
      />

      {/* Drawer — slide from bottom */}
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-gray-900 rounded-t-2xl pb-safe md:hidden max-h-[85dvh] flex flex-col">
        {/* Handle bar */}
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <div className="flex items-center gap-3">
            <Avatar className="h-9 w-9">
              <AvatarFallback className="text-xs text-white bg-teal-700">{initials}</AvatarFallback>
            </Avatar>
            <div>
              <div className="text-sm font-medium text-white">{userName || userEmail}</div>
              {teamName && <div className="text-xs text-gray-400">{teamName}</div>}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-white rounded-lg hover:bg-gray-800"
            aria-label="Fechar menu"
          >
            <X size={20} />
          </button>
        </div>

        <div className="w-8 h-1 bg-gray-700 rounded-full mx-auto mb-2" />

        {/* Nav links */}
        <nav className="flex-1 overflow-y-auto px-3 pb-4 space-y-0.5">
          {ALL_NAV.map(({ href, label, icon: Icon, exact }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium transition-colors',
                isActive(href, exact)
                  ? 'bg-teal-700 text-white'
                  : 'text-gray-300 active:bg-gray-800 active:text-white'
              )}
            >
              <Icon size={20} className="flex-shrink-0" />
              {label}
            </Link>
          ))}
        </nav>

        {/* Logout */}
        <div className="px-3 pb-6 pt-2 border-t border-gray-700">
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 w-full px-3 py-3 rounded-xl text-sm font-medium text-gray-300 active:bg-gray-800 active:text-white transition-colors"
          >
            <LogOut size={20} />
            Terminar sessão
          </button>
        </div>
      </div>
    </>
  )
}
