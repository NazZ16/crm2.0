'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard,
  Users,
  Kanban,
  CheckSquare,
  Menu,
} from 'lucide-react'
import { useState } from 'react'
import { MobileDrawer } from './MobileDrawer'

const BOTTOM_NAV = [
  { href: '/dashboard', label: 'Início', icon: LayoutDashboard, exact: true },
  { href: '/dashboard/tasks', label: 'Tarefas', icon: CheckSquare },
  { href: '/dashboard/leads', label: 'Leads', icon: Users },
  { href: '/dashboard/pipeline', label: 'Pipeline', icon: Kanban },
]

interface MobileNavProps {
  userEmail?: string
  userName?: string
  teamName?: string
}

export function MobileNav({ userEmail, userName, teamName }: MobileNavProps) {
  const pathname = usePathname()
  const [drawerOpen, setDrawerOpen] = useState(false)

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname.startsWith(href)

  return (
    <>
      {/* Bottom tab bar — faz parte do fluxo, não é fixed */}
      <nav className="bg-gray-900 border-t border-gray-700 flex md:hidden">
        {BOTTOM_NAV.map(({ href, label, icon: Icon, exact }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex-1 flex flex-col items-center justify-center py-2 gap-0.5 text-xs font-medium transition-colors',
              isActive(href, exact)
                ? 'text-teal-400'
                : 'text-gray-400 active:text-white'
            )}
          >
            <Icon size={20} strokeWidth={isActive(href, exact) ? 2.5 : 1.75} />
            <span className="text-[10px] leading-tight">{label}</span>
          </Link>
        ))}

        {/* More button → drawer */}
        <button
          onClick={() => setDrawerOpen(true)}
          className={cn(
            'flex-1 flex flex-col items-center justify-center py-2 gap-0.5 text-xs font-medium transition-colors',
            drawerOpen ? 'text-teal-400' : 'text-gray-400 active:text-white'
          )}
        >
          <Menu size={20} strokeWidth={1.75} />
          <span className="text-[10px] leading-tight">Mais</span>
        </button>
      </nav>

      {/* Drawer with all items */}
      <MobileDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        userEmail={userEmail}
        userName={userName}
        teamName={teamName}
      />
    </>
  )
}
