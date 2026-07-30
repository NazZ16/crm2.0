import { createClient } from '@/lib/supabase/server'
import type { Partner } from '@/lib/types'
import { PartnersClient } from './PartnersClient'

export const dynamic = 'force-dynamic'

export default async function PartnersPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: member } = await supabase
    .from('team_members')
    .select('team_id, role')
    .eq('user_id', user.id)
    .single()

  if (!member) return null

  const { data: partners } = await supabase
    .from('partners')
    .select('*')
    .eq('team_id', member.team_id)
    .order('name', { ascending: true })

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Parceiros</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Diretório de contactos de confiança — crédito, advogado, empreiteiros, e outros.
        </p>
      </div>

      <PartnersClient
        initialPartners={(partners as Partner[]) ?? []}
        canEdit={member.role !== 'viewer'}
      />
    </div>
  )
}
