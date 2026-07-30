import { createClient } from '@/lib/supabase/server'
import { formatDateTime, formatRelativeTime } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Bot, CheckCircle2, XCircle, Clock, Zap, Brain } from 'lucide-react'
import { AgentsClient } from './AgentsClient'

export const dynamic = 'force-dynamic'

const agentLabels: Record<string, { label: string; icon: string; color: string }> = {
  lead: { label: 'Agente de Leads', icon: '🔍', color: 'bg-blue-100 text-blue-700' },
  followup: { label: 'Agente Follow-up', icon: '📅', color: 'bg-green-100 text-green-700' },
  coach: { label: 'Coach IA', icon: '🎓', color: 'bg-purple-100 text-purple-700' },
  marketing: { label: 'Agente Marketing', icon: '📈', color: 'bg-orange-100 text-orange-700' },
  investor: { label: 'Agente Investidor', icon: '🏗️', color: 'bg-pink-100 text-pink-700' },
  orientator: { label: 'Orientador', icon: '🧭', color: 'bg-teal-100 text-teal-700' },
}

export default async function AgentsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: member } = await supabase
    .from('team_members')
    .select('team_id, role')
    .eq('user_id', user.id)
    .single()

  if (!member) return null

  // Fetch agent runs + learnings
  const [runsRes, learningsRes] = await Promise.all([
    supabase
      .from('agent_runs')
      .select('id, agent_type, status, trigger_type, input_summary, tokens_used, duration_ms, created_at, lead_id, error')
      .eq('team_id', member.team_id)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('agent_learnings')
      .select('id, learning_type, content, confidence, tags, times_confirmed, created_at')
      .eq('team_id', member.team_id)
      .order('confidence', { ascending: false })
      .limit(30),
  ])

  const runs = runsRes.data ?? []
  const learnings = learningsRes.data ?? []

  const totalRuns = runs.length
  const doneRuns = runs.filter((r) => r.status === 'done').length
  const failedRuns = runs.filter((r) => r.status === 'failed').length
  const totalTokens = runs.reduce((sum, r) => sum + (r.tokens_used ?? 0), 0)
  const avgDuration = runs.length > 0
    ? Math.round(runs.reduce((sum, r) => sum + (r.duration_ms ?? 0), 0) / runs.length / 1000)
    : 0

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Agentes IA</h1>
          <p className="text-sm text-gray-500 mt-0.5">Monitoriza a actividade e aprendizagens dos agentes</p>
        </div>
        {member.role !== 'viewer' && (
          <AgentsClient />
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <Bot size={20} className="text-blue-500" />
              <div>
                <div className="text-2xl font-bold">{totalRuns}</div>
                <div className="text-xs text-gray-500">Total de execuções</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <CheckCircle2 size={20} className="text-green-500" />
              <div>
                <div className="text-2xl font-bold text-green-700">{doneRuns}</div>
                <div className="text-xs text-gray-500">Concluídas</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <Zap size={20} className="text-purple-500" />
              <div>
                <div className="text-2xl font-bold">{(totalTokens / 1000).toFixed(0)}k</div>
                <div className="text-xs text-gray-500">Tokens usados</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <Brain size={20} className="text-orange-500" />
              <div>
                <div className="text-2xl font-bold">{learnings.length}</div>
                <div className="text-xs text-gray-500">Aprendizagens</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Agent Runs */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base">Histórico de Execuções</CardTitle>
          </CardHeader>
          <CardContent>
            {runs.length === 0 ? (
              <div className="text-center py-8">
                <Bot size={40} className="mx-auto text-gray-200 mb-2" />
                <p className="text-sm text-gray-400">Sem execuções ainda</p>
                <p className="text-xs text-gray-300 mt-1">Analisa uma conversa para ver os agentes em acção</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {runs.map((run) => {
                  const agent = agentLabels[run.agent_type]
                  return (
                    <div key={run.id} className="flex items-start gap-3 p-3 rounded-lg bg-gray-50">
                      <div className={`p-1.5 rounded text-sm flex-shrink-0 ${agent?.color ?? 'bg-gray-100 text-gray-600'}`}>
                        {agent?.icon ?? '🤖'}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-gray-700">
                            {agent?.label ?? run.agent_type}
                          </span>
                          <Badge
                            variant="outline"
                            className={`text-xs ${
                              run.status === 'done' ? 'text-green-600 border-green-200' :
                              run.status === 'failed' ? 'text-red-600 border-red-200' :
                              'text-yellow-600 border-yellow-200'
                            }`}
                          >
                            {run.status === 'done' ? 'OK' : run.status === 'failed' ? 'Erro' : '...'}
                          </Badge>
                        </div>
                        {run.input_summary && (
                          <p className="text-xs text-gray-500 truncate mt-0.5">{run.input_summary}</p>
                        )}
                        {run.error && (
                          <p className="text-xs text-red-500 mt-0.5">{run.error}</p>
                        )}
                        <div className="flex items-center gap-3 mt-1 text-xs text-gray-400">
                          <span>{formatRelativeTime(run.created_at)}</span>
                          {run.tokens_used && <span>{run.tokens_used} tokens</span>}
                          {run.duration_ms && <span>{(run.duration_ms / 1000).toFixed(1)}s</span>}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Agent Learnings */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Brain size={16} className="text-orange-500" />
              Aprendizagens do Coach
            </CardTitle>
          </CardHeader>
          <CardContent>
            {learnings.length === 0 ? (
              <div className="text-center py-8">
                <Brain size={40} className="mx-auto text-gray-200 mb-2" />
                <p className="text-sm text-gray-400">Sem aprendizagens ainda</p>
                <p className="text-xs text-gray-300 mt-1">Acumula deals ganhos/perdidos para o Coach aprender</p>
              </div>
            ) : (
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {learnings.map((learning) => {
                  const confidencePct = Math.round(learning.confidence * 100)
                  const typeLabels: Record<string, string> = {
                    conversion_pattern: '🔄 Padrão',
                    objection: '🚧 Objeção',
                    timing: '⏱️ Timing',
                    source: '📡 Fonte',
                    behavior: '🧠 Comportamento',
                  }
                  return (
                    <div key={learning.id} className="p-3 bg-orange-50 rounded-lg border border-orange-100">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-orange-700">
                          {typeLabels[learning.learning_type] ?? learning.learning_type}
                        </span>
                        <span className={`text-xs font-bold ${
                          confidencePct >= 75 ? 'text-green-600' :
                          confidencePct >= 50 ? 'text-yellow-600' : 'text-gray-500'
                        }`}>
                          {confidencePct}% confiança
                        </span>
                      </div>
                      <p className="text-sm text-gray-700">{learning.content}</p>
                      {learning.tags.length > 0 && (
                        <div className="flex gap-1 mt-2 flex-wrap">
                          {learning.tags.map((tag: string) => (
                            <span key={tag} className="text-xs bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded">
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
