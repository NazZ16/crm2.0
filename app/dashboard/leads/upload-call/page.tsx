'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Upload, Mic, CheckCircle2, AlertCircle, Loader2, ArrowLeft } from 'lucide-react'

type UploadStatus = 'idle' | 'uploading' | 'pending' | 'transcribing' | 'analyzing' | 'done' | 'failed'

interface ScriptAnalise {
  abertura: string
  descoberta: string
  objecoes: string
  fecho: string
  perguntas_sugeridas: string[]
  frases_a_evitar: string[]
  nota_script: number
}

interface CoachFeedback {
  sentimento_lead: string
  pontos_positivos: string[]
  a_melhorar: string[]
  proxima_chamada: string
  script_analise?: ScriptAnalise
}

interface UploadStatusResponse {
  id: string
  status: UploadStatus
  error?: string | null
  lead_id?: string | null
  coach_feedback?: CoachFeedback | null
  audio_duration_s?: number | null
  processed_at?: string | null
}

const STATUS_LABELS: Record<UploadStatus, string> = {
  idle: 'Pronto',
  uploading: 'A fazer upload...',
  pending: 'A iniciar processamento...',
  transcribing: 'A transcrever áudio (Whisper)...',
  analyzing: 'A analisar com IA...',
  done: 'Concluído',
  failed: 'Erro',
}

const ALLOWED_TYPES = ['audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/wav', 'audio/wave', 'audio/m4a']
const ALLOWED_EXTENSIONS = ['.mp3', '.m4a', '.wav']
const MAX_SIZE_MB = 50
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024
const POLL_INTERVAL_MS = 3000
const MAX_POLLS = 40

function isAllowedFile(file: File): boolean {
  const lower = file.name.toLowerCase()
  const extOk = ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext))
  const typeOk = ALLOWED_TYPES.includes(file.type)
  return extOk || typeOk
}

export default function UploadCallPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollCountRef = useRef(0)

  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [status, setStatus] = useState<UploadStatus>('idle')
  const [uploadId, setUploadId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<CoachFeedback | null>(null)
  const [leadId, setLeadId] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => stopPolling()
  }, [stopPolling])

  const pollStatus = useCallback(
    async (id: string) => {
      pollCountRef.current += 1
      if (pollCountRef.current > MAX_POLLS) {
        stopPolling()
        setStatus('failed')
        setError('Tempo de processamento excedido. Tente novamente.')
        return
      }

      try {
        const res = await fetch(`/api/calls/${id}/status`)
        if (!res.ok) return

        const data: UploadStatusResponse = await res.json()
        setStatus(data.status)

        if (data.status === 'done') {
          stopPolling()
          if (data.coach_feedback) setFeedback(data.coach_feedback)
          if (data.lead_id) setLeadId(data.lead_id)
        } else if (data.status === 'failed') {
          stopPolling()
          setError(data.error ?? 'Erro desconhecido no processamento.')
        }
      } catch {
        // Network error — keep polling
      }
    },
    [stopPolling]
  )

  const startPolling = useCallback(
    (id: string) => {
      pollCountRef.current = 0
      pollRef.current = setInterval(() => pollStatus(id), POLL_INTERVAL_MS)
    },
    [pollStatus]
  )

  const handleFileSelect = useCallback((file: File) => {
    setFileError(null)
    if (!isAllowedFile(file)) {
      setFileError('Tipo de ficheiro não suportado. Use mp3, m4a ou wav.')
      return
    }
    if (file.size > MAX_SIZE_BYTES) {
      setFileError(`Ficheiro demasiado grande. Máximo ${MAX_SIZE_MB}MB.`)
      return
    }
    setSelectedFile(file)
  }, [])

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) handleFileSelect(file)
    },
    [handleFileSelect]
  )

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback(() => {
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      setIsDragging(false)
      const file = e.dataTransfer.files?.[0]
      if (file) handleFileSelect(file)
    },
    [handleFileSelect]
  )

  const handleSubmit = useCallback(async () => {
    if (!selectedFile) return
    setError(null)
    setFeedback(null)
    setLeadId(null)
    setStatus('uploading')

    const formData = new FormData()
    formData.append('audio', selectedFile)

    try {
      const res = await fetch('/api/calls/upload', {
        method: 'POST',
        body: formData,
      })

      const body = await res.json()

      if (!res.ok) {
        setStatus('failed')
        setError(body.error ?? 'Erro ao fazer upload.')
        return
      }

      const id: string = body.upload_id
      setUploadId(id)
      setStatus('pending')

      // Iniciar o processamento em background (separado do upload para evitar timeouts)
      // Começar polling imediatamente enquanto o processo arranca
      startPolling(id)

      // Chamar o endpoint de processamento — pode demorar até 5 minutos
      // O resultado é seguido via polling ao status endpoint
      fetch(`/api/calls/process/${id}`, { method: 'POST' }).catch(() => {
        // Se o fetch falhar, o polling vai detetar o status 'failed' na BD
      })
    } catch {
      setStatus('failed')
      setError('Erro de rede. Verifique a sua ligação e tente novamente.')
    }
  }, [selectedFile, startPolling])

  const handleRetry = useCallback(() => {
    stopPolling()
    setStatus('idle')
    setUploadId(null)
    setError(null)
    setFeedback(null)
    setLeadId(null)
    setSelectedFile(null)
    pollCountRef.current = 0
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [stopPolling])

  // Auto-arrancar polling quando redirecionado do share target (?id=...)
  useEffect(() => {
    const sharedId = searchParams.get('id')
    if (sharedId && status === 'idle') {
      setUploadId(sharedId)
      setStatus('pending')
      startPolling(sharedId)
    }
    const shareError = searchParams.get('error')
    if (shareError) {
      const msgs: Record<string, string> = {
        tipo_invalido: 'Tipo de ficheiro não suportado. Use mp3, m4a ou wav.',
        ficheiro_grande: `Ficheiro demasiado grande. Máximo ${MAX_SIZE_MB}MB.`,
        upload_falhou: 'Erro ao fazer upload do ficheiro partilhado.',
        registo_falhou: 'Erro interno. Tente novamente.',
      }
      setFileError(msgs[shareError] ?? 'Erro ao processar o ficheiro partilhado.')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const isProcessing = ['uploading', 'pending', 'transcribing', 'analyzing'].includes(status)
  const isDisabled = !selectedFile || isProcessing

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2">
        <Link
          href="/dashboard/leads"
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          <ArrowLeft size={14} />
          Voltar às leads
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-bold text-gray-900">Upload de Chamada</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Faça upload de um áudio de chamada para transcrição e análise automática com IA
        </p>
      </div>

      {/* Upload Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Mic size={18} />
            Selecionar ficheiro de áudio
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Drag-and-drop zone */}
          <div
            role="button"
            tabIndex={0}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click()
            }}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`
              border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors
              ${isDragging ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'}
              ${isProcessing ? 'pointer-events-none opacity-50' : ''}
            `}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".mp3,.m4a,.wav,audio/mpeg,audio/mp4,audio/x-m4a,audio/wav"
              className="hidden"
              onChange={handleInputChange}
              disabled={isProcessing}
            />
            <Upload size={32} className="mx-auto text-gray-400 mb-3" />
            {selectedFile ? (
              <div>
                <p className="font-medium text-gray-800">{selectedFile.name}</p>
                <p className="text-sm text-gray-500 mt-1">
                  {(selectedFile.size / 1024 / 1024).toFixed(1)} MB
                </p>
              </div>
            ) : (
              <div>
                <p className="text-gray-600 font-medium">
                  Arraste o ficheiro aqui ou clique para selecionar
                </p>
                <p className="text-sm text-gray-400 mt-1">
                  MP3, M4A, WAV — máximo {MAX_SIZE_MB}MB
                </p>
              </div>
            )}
          </div>

          {fileError && (
            <p className="text-sm text-red-600 flex items-center gap-1.5">
              <AlertCircle size={14} />
              {fileError}
            </p>
          )}

          {/* Submit button */}
          <Button
            onClick={handleSubmit}
            disabled={isDisabled}
            className="w-full gap-2"
          >
            {isProcessing ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                {STATUS_LABELS[status]}
              </>
            ) : (
              <>
                <Upload size={16} />
                Enviar e analisar
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Status display */}
      {status !== 'idle' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              {status === 'done' && <CheckCircle2 size={18} className="text-green-500" />}
              {status === 'failed' && <AlertCircle size={18} className="text-red-500" />}
              {isProcessing && <Loader2 size={18} className="animate-spin text-blue-500" />}
              Estado do processamento
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <Badge
                className={
                  status === 'done'
                    ? 'bg-green-100 text-green-700'
                    : status === 'failed'
                    ? 'bg-red-100 text-red-700'
                    : 'bg-blue-100 text-blue-700'
                }
              >
                {STATUS_LABELS[status]}
              </Badge>
              {uploadId && (
                <span className="text-xs text-gray-400 font-mono">{uploadId}</span>
              )}
            </div>

            {/* Progress steps */}
            {isProcessing && (
              <div className="space-y-2">
                {(['uploading', 'pending', 'transcribing', 'analyzing'] as const).map((step) => {
                  const stepOrder = ['uploading', 'pending', 'transcribing', 'analyzing']
                  const currentIdx = stepOrder.indexOf(status)
                  const stepIdx = stepOrder.indexOf(step)
                  const isDone = stepIdx < currentIdx
                  const isCurrent = stepIdx === currentIdx

                  return (
                    <div key={step} className="flex items-center gap-2 text-sm">
                      {isDone ? (
                        <CheckCircle2 size={14} className="text-green-500 flex-shrink-0" />
                      ) : isCurrent ? (
                        <Loader2 size={14} className="animate-spin text-blue-500 flex-shrink-0" />
                      ) : (
                        <div className="w-3.5 h-3.5 rounded-full border border-gray-300 flex-shrink-0" />
                      )}
                      <span className={isCurrent ? 'text-gray-900 font-medium' : isDone ? 'text-gray-500' : 'text-gray-300'}>
                        {STATUS_LABELS[step]}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Error */}
            {status === 'failed' && error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            {/* Done: coach feedback */}
            {status === 'done' && feedback && (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-700">Sentimento da lead:</span>
                  <Badge className="bg-purple-100 text-purple-700">{feedback.sentimento_lead}</Badge>
                </div>

                {feedback.pontos_positivos?.length > 0 && (
                  <div>
                    <p className="text-sm font-semibold text-green-700 mb-1.5">Pontos positivos</p>
                    <ul className="space-y-1">
                      {feedback.pontos_positivos.map((p, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                          <CheckCircle2 size={13} className="text-green-500 mt-0.5 flex-shrink-0" />
                          {p}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {feedback.a_melhorar?.length > 0 && (
                  <div>
                    <p className="text-sm font-semibold text-amber-700 mb-1.5">A melhorar</p>
                    <ul className="space-y-1">
                      {feedback.a_melhorar.map((p, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                          <AlertCircle size={13} className="text-amber-500 mt-0.5 flex-shrink-0" />
                          {p}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {feedback.proxima_chamada && (
                  <div className="bg-blue-50 border border-blue-100 rounded-lg p-3">
                    <p className="text-xs font-semibold text-blue-600 mb-1">Próxima chamada</p>
                    <p className="text-sm text-gray-700">{feedback.proxima_chamada}</p>
                  </div>
                )}

                {feedback.script_analise && (
                  <div className="border border-gray-200 rounded-lg overflow-hidden">
                    <div className="bg-gray-50 px-3 py-2 flex items-center justify-between">
                      <p className="text-sm font-semibold text-gray-700">Análise do script</p>
                      <span className="text-xs font-bold text-white bg-gray-700 rounded-full px-2 py-0.5">
                        {feedback.script_analise.nota_script}/10
                      </span>
                    </div>
                    <div className="p-3 space-y-3 text-sm">
                      {[
                        { label: 'Abertura', value: feedback.script_analise.abertura },
                        { label: 'Descoberta', value: feedback.script_analise.descoberta },
                        { label: 'Objeções', value: feedback.script_analise.objecoes },
                        { label: 'Fecho', value: feedback.script_analise.fecho },
                      ].map(({ label, value }) => value && (
                        <div key={label}>
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">{label}</p>
                          <p className="text-gray-700">{value}</p>
                        </div>
                      ))}

                      {feedback.script_analise.perguntas_sugeridas?.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Perguntas que faltaram</p>
                          <ul className="space-y-1">
                            {feedback.script_analise.perguntas_sugeridas.map((q, i) => (
                              <li key={i} className="flex items-start gap-2 text-gray-700">
                                <span className="text-blue-400 flex-shrink-0">→</span>
                                {q}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {feedback.script_analise.frases_a_evitar?.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">A evitar</p>
                          <ul className="space-y-1">
                            {feedback.script_analise.frases_a_evitar.map((f, i) => (
                              <li key={i} className="flex items-start gap-2 text-gray-700">
                                <span className="text-red-400 flex-shrink-0">✕</span>
                                {f}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3 pt-1">
              {status === 'done' && leadId && (
                <Button onClick={() => router.push(`/dashboard/leads/${leadId}`)} className="gap-2">
                  <ArrowLeft size={14} className="rotate-180" />
                  Ver lead
                </Button>
              )}
              {status === 'failed' && (
                <Button variant="outline" onClick={handleRetry} className="gap-2">
                  Tentar novamente
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
