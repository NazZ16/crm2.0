'use client'

import { useRouter } from 'next/navigation'
import { ExtractionReview } from '@/components/agent/ExtractionReview'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Sparkles } from 'lucide-react'
import type { AgentExtractionResult, AgentRecommendations, AgentDrafts } from '@/lib/types'

interface Props {
  extractionId: string
  leadPhone: string | null
  leadEmail: string | null
  leadUpdates: AgentExtractionResult
  recommendations: AgentRecommendations
  drafts: AgentDrafts
}

export function PendingExtractionBanner(props: Props) {
  const router = useRouter()

  return (
    <Card className="border-blue-200 bg-blue-50/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold text-blue-800 flex items-center gap-2">
          <Sparkles size={14} />
          Nova análise por rever
        </CardTitle>
        <CardDescription className="text-blue-700">
          O agente analisou uma conversa/chamada desta lead. Revê e aplica ao perfil (ou descarta).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ExtractionReview
          leadPhone={props.leadPhone}
          leadEmail={props.leadEmail}
          leadUpdates={props.leadUpdates}
          recommendations={props.recommendations}
          drafts={props.drafts}
          extractionId={props.extractionId}
          onApplied={() => router.refresh()}
          onDismissed={() => router.refresh()}
        />
      </CardContent>
    </Card>
  )
}
