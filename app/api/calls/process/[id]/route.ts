// app/api/calls/process/[id]/route.ts
// Inicia o processamento (transcrição + pipeline IA) de um upload de áudio já registado.
// Separado do upload para evitar timeouts em chamadas longas.

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { runCallPipeline } from '@/lib/call-pipeline'

export const maxDuration = 300 // 5 minutos para processamento longo

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()

  // Auth
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: member } = await supabase
    .from('team_members')
    .select('team_id, role')
    .eq('user_id', user.id)
    .single()

  if (!member || member.role === 'viewer') {
    return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
  }

  const svc = createServiceClient()

  // Verificar que o upload existe e pertence ao team (sem lock ainda)
  const { data: upload } = await svc
    .from('call_uploads')
    .select('id, team_id, storage_path, status')
    .eq('id', id)
    .eq('team_id', member.team_id)
    .single()

  if (!upload) return NextResponse.json({ error: 'Upload não encontrado' }, { status: 404 })

  // Marcar atomicamente como 'transcribing' — só actualiza se ainda estiver 'pending'.
  // Isto previne race conditions: dois requests simultâneos só um consegue o "lock".
  const { data: claimed } = await svc
    .from('call_uploads')
    .update({ status: 'transcribing', updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'pending') // só atualiza se ainda estiver pending
    .select('id')
    .maybeSingle()

  if (!claimed) {
    // Outro processo já tomou conta — verificar o estado actual
    const { data: current } = await svc
      .from('call_uploads')
      .select('status')
      .eq('id', id)
      .single()
    const currentStatus = current?.status ?? 'unknown'
    if (currentStatus === 'done') {
      return NextResponse.json({ error: 'Já foi processado' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Já está a ser processado' }, { status: 409 })
  }
  // Aqui: temos o "lock" — só um processo chegou aqui com sucesso

  try {
    // Fazer download do ficheiro do Storage
    const { data: fileData, error: downloadError } = await svc.storage
      .from('call-audio')
      .download(upload.storage_path)

    if (downloadError || !fileData) {
      await svc
        .from('call_uploads')
        .update({
          status: 'failed',
          error: downloadError?.message ?? 'Falha ao obter ficheiro de áudio',
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
      return NextResponse.json({ error: 'Erro ao obter ficheiro' }, { status: 500 })
    }

    // Converter Blob para Buffer
    const arrayBuffer = await fileData.arrayBuffer()
    const audioBuffer = Buffer.from(arrayBuffer)

    // Extrair nome do ficheiro do storage_path (ex: "teamId/calls/timestamp-filename.mp3")
    const filename = upload.storage_path.split('/').pop() ?? 'audio.mp3'

    // Correr o pipeline de processamento (transcrição + IA + dedup)
    // O pipeline trata internamente de atualizar o status para 'analyzing', 'done' ou 'failed'
    await runCallPipeline(id, member.team_id, audioBuffer, filename, user.id)

    return NextResponse.json({ ok: true, status: 'done' })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido'
    await svc
      .from('call_uploads')
      .update({
        status: 'failed',
        error: message,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
