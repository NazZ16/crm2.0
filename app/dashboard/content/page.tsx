import { createClient } from '@/lib/supabase/server'
import { CONTENT_STATUS_ORDER, type ContentPiece, type ContentStatus } from '@/lib/types'
import { ContentBoard } from './ContentBoard'
import NewContentButton from './NewContentButton'

export const dynamic = 'force-dynamic'

export default async function ContentPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: member } = await supabase
    .from('team_members')
    .select('team_id, role')
    .eq('user_id', user.id)
    .single()

  if (!member) return null

  const { data: pieces } = await supabase
    .from('content_pieces')
    .select('*')
    .eq('team_id', member.team_id)
    .neq('status', 'archived')
    .order('scheduled_at', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(300)

  const allPieces = (pieces ?? []) as ContentPiece[]

  const grouped: Record<ContentStatus, ContentPiece[]> = {
    idea: [], draft: [], scheduled: [], published: [], archived: [],
  }
  for (const p of allPieces) {
    if (grouped[p.status]) grouped[p.status].push(p)
  }

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4 overflow-x-hidden">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-xl md:text-2xl font-bold text-gray-900">Conteúdo</h1>
          <p className="text-xs md:text-sm text-gray-500 mt-0.5">
            {allPieces.length} peças — pipeline de conteúdo da marca pessoal
          </p>
        </div>
        <NewContentButton />
      </div>

      <ContentBoard
        grouped={grouped}
        order={CONTENT_STATUS_ORDER}
        canEdit={member.role !== 'viewer'}
      />
    </div>
  )
}
