// app/api/share-target/route.ts
// Recebe áudio partilhado via Web Share Target API (PWA).
// Faz upload para Supabase Storage, cria call_upload e redireciona para a página de progresso.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { runCallPipeline } from '@/lib/call-pipeline'

export const maxDuration = 30

const ALLOWED_MIME_TYPES = ['audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/wav', 'audio/wave', 'audio/m4a', 'audio/ogg']
const ALLOWED_EXTENSIONS = ['.mp3', '.m4a', '.wav', '.ogg']
const MAX_FILE_SIZE = 50 * 1024 * 1024

function sanitizeFilename(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 200)
}

function hasAllowedExtension(filename: string): boolean {
  const lower = filename.toLowerCase()
  return ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

const FALLBACK_URL = '/dashboard/leads/upload-call'

export async function POST(request: Request) {
  const supabase = await createClient()

  // Auth
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  const { data: member } = await supabase
    .from('team_members')
    .select('team_id, role')
    .eq('user_id', user.id)
    .single()

  if (!member || member.role === 'viewer') {
    return NextResponse.redirect(new URL(FALLBACK_URL, request.url))
  }

  const teamId: string = member.team_id

  // Parse multipart (campo "audio" configurado no manifest share_target)
  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.redirect(new URL(FALLBACK_URL, request.url))
  }

  const audioFile = formData.get('audio')
  if (!audioFile || !(audioFile instanceof File)) {
    return NextResponse.redirect(new URL(FALLBACK_URL, request.url))
  }

  // Validar
  if (!hasAllowedExtension(audioFile.name) && !ALLOWED_MIME_TYPES.includes(audioFile.type)) {
    return NextResponse.redirect(new URL(FALLBACK_URL + '?error=tipo_invalido', request.url))
  }

  if (audioFile.size > MAX_FILE_SIZE) {
    return NextResponse.redirect(new URL(FALLBACK_URL + '?error=ficheiro_grande', request.url))
  }

  const sanitizedFilename = sanitizeFilename(audioFile.name || 'audio.mp3')
  const storagePath = `${teamId}/calls/${Date.now()}-${sanitizedFilename}`

  // Upload para Supabase Storage
  const arrayBuffer = await audioFile.arrayBuffer()
  const audioBuffer = Buffer.from(arrayBuffer)

  const { error: storageError } = await supabase.storage
    .from('call-audio')
    .upload(storagePath, audioBuffer, {
      contentType: audioFile.type || 'audio/mpeg',
      upsert: false,
    })

  if (storageError) {
    return NextResponse.redirect(new URL(FALLBACK_URL + '?error=upload_falhou', request.url))
  }

  // Criar registo call_uploads
  const { data: uploadRow, error: insertError } = await supabase
    .from('call_uploads')
    .insert({
      team_id: teamId,
      storage_path: storagePath,
      status: 'transcribing',
    })
    .select('id')
    .single()

  if (insertError || !uploadRow) {
    void supabase.storage.from('call-audio').remove([storagePath])
    return NextResponse.redirect(new URL(FALLBACK_URL + '?error=registo_falhou', request.url))
  }

  // Disparar pipeline em background (mesmo que /api/calls/upload)
  void runCallPipeline(uploadRow.id, teamId, audioBuffer, sanitizedFilename, user.id)

  // Redirecionar para a página de progresso
  return NextResponse.redirect(
    new URL(`/dashboard/leads/upload-call?id=${uploadRow.id}`, request.url)
  )
}
