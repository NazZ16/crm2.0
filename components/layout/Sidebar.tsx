'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
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
  ChevronLeft,
  ChevronRight,
  Building2,
  Building,
  Home,
  GitMerge,
  UsersRound,
  Phone,
  CheckSquare,
  Snowflake,
  PenSquare,
  Contact,
} from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { href: '/dashboard/tasks', label: 'Tarefas', icon: CheckSquare },
  { href: '/dashboard/leads', label: 'Leads', icon: Users },
  { href: '/dashboard/pipeline', label: 'Pipeline', icon: Kanban },
  { href: '/dashboard/cold-leads', label: 'Leads frias', icon: Snowflake },
  { href: '/dashboard/partners', label: 'Parceiros', icon: Contact },
  { href: '/dashboard/investors', label: 'Investidores', icon: Building2 },
  { href: '/dashboard/opportunities', label: 'Oportunidades', icon: Home },
  { href: '/dashboard/listings', label: 'Imóveis', icon: Building },
  { href: '/dashboard/matching', label: 'Matches', icon: GitMerge },
  { href: '/dashboard/marketing', label: 'Marketing', icon: Megaphone },
  { href: '/dashboard/content', label: 'Conteúdo', icon: PenSquare },
  { href: '/dashboard/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/dashboard/agents', label: 'Agentes IA', icon: Bot },
  { href: '/dashboard/calls/history', label: 'Chamadas', icon: Phone },
]

const BOTTOM_ITEMS = [
  { href: '/dashboard/team', label: 'Equipa', icon: UsersRound },
  { href: '/dashboard/settings', label: 'Definicoes', icon: Settings },
]

interface SidebarProps {
  userEmail?: string
  userName?: string
  teamName?: string
}

export function Sidebar({ userEmail, userName, teamName }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  const [collapsed, setCollapsed] = useState(false)

  async function handleLogout() {
    await supabase.auth.signOut()
    toast.success('Sessao terminada')
    router.push('/login')
    router.refresh()
  }

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname.startsWith(href)

  const initials = userName
    ? userName.split(' ').slice(0, 2).map((n) => n[0]).join('').toUpperCase()
    : userEmail?.[0]?.toUpperCase() ?? 'U'

  return (
    <aside
      className={cn(
        'flex flex-col h-screen bg-gray-900 text-gray-100',
        'transition-[width] duration-200 motion-reduce:transition-none',
        collapsed ? 'w-16' : 'w-60'
      )}
    >
      <div className="flex items-center gap-3 px-4 py-5 border-b border-gray-700">
        <Building2 size={20} className="text-teal-400 flex-shrink-0" />
        {!collapsed && (
          <div className="min-w-0">
            <div className="font-bold text-white text-sm truncate">CRM 2.0</div>
            {teamName && (
              <div className="text-xs text-gray-400 truncate">{teamName}</div>
            )}
          </div>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? 'Expandir sidebar' : 'Colapsar sidebar'}
          className="ml-auto p-2 text-gray-400 hover:text-white cursor-pointer flex-shrink-0 rounded-md hover:bg-gray-800 transition-colors"
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>

      <nav className="flex-1 px-2 py-4 space-y-1 overflow-y-auto">
        {NAV_ITEMS.map(({ href, label, icon: Icon, exact }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer',
              isActive(href, exact)
                ? 'bg-teal-700 text-white'
                : 'text-gray-300 hover:bg-gray-800 hover:text-white'
            )}
            title={collapsed ? label : undefined}
          >
            <Icon size={18} className="flex-shrink-0" />
            {!collapsed && <span>{label}</span>}
          </Link>
        ))}
      </nav>

      <div className="px-2 py-3 border-t border-gray-700 space-y-1">
        {BOTTOM_ITEMS.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer',
              isActive(href)
                ? 'bg-teal-700 text-white'
                : 'text-gray-300 hover:bg-gray-800 hover:text-white'
            )}
            title={collapsed ? label : undefined}
          >
            <Icon size={18} className="flex-shrink-0" />
            {!collapsed && <span>{label}</span>}
          </Link>
        ))}

        <div className="flex items-center gap-3 px-3 py-2.5">
          <Avatar className="h-9 w-9 flex-shrink-0">
            <AvatarFallback className="text-xs text-white bg-teal-700">
              {initials}
            </AvatarFallback>
          </Avatar>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium text-gray-200 truncate">
                {userName || userEmail}
              </div>
              {userName && (
                <div className="text-xs text-gray-500 truncate">{userEmail}</div>
              )}
            </div>
          )}
          {!collapsed && (
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 text-gray-400 hover:text-white hover:bg-gray-800 cursor-pointer"
              onClick={handleLogout}
              aria-label="Terminar sessao"
              title="Terminar sessao"
            >
              <LogOut size={16} />
            </Button>
          )}
        </div>
      </div>
    </aside>
  )
}
