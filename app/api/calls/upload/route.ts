import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const maxDuration = 60

const ALLOWED_MIME_TYPES = ['audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/wav', 'audio/wave', 'audio/m4a']
const ALLOWED_EXTENSIONS = ['.mp3', '.m4a', '.wav']
const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB

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

export async function POST(request: Request) {
  const supabase = await createClient()

  // Step 1: Auth
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  }

  const { data: member } = await supabase
    .from('team_members')
    .select('team_id, role')
    .eq('user_id', user.id)
    .single()

  if (!member || member.role === 'viewer') {
    return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
  }

  const teamId: string = member.team_id

  // Step 2: Parse multipart form
  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Erro ao ler formulário multipart' }, { status: 400 })
  }

  const audioFile = formData.get('audio')
  if (!audioFile || !(audioFile instanceof File)) {
    return NextResponse.json({ error: 'Campo "audio" obrigatório' }, { status: 400 })
  }

  // Step 3: Validate file
  if (!hasAllowedExtension(audioFile.name) && !ALLOWED_MIME_TYPES.includes(audioFile.type)) {
    return NextResponse.json(
      { error: 'Tipo de ficheiro não suportado. Use mp3, m4a ou wav.' },
      { status: 400 }
    )
  }

  if (audioFile.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: 'Ficheiro demasiado grande. Máximo 50MB.' },
      { status: 400 }
    )
  }

  const sanitizedFilename = sanitizeFilename(audioFile.name)
  const storagePath = `${teamId}/calls/${Date.now()}-${sanitizedFilename}`

  // Step 4: Upload to Supabase Storage
  const arrayBuffer = await audioFile.arrayBuffer()
  const audioBuffer = Buffer.from(arrayBuffer)

  // Criar bucket se não existir (primeira execução)
  await supabase.storage.createBucket('call-audio', { public: false, fileSizeLimit: 52428800 }).catch(() => {})

  const { error: storageError } = await supabase.storage
    .from('call-audio')
    .upload(storagePath, audioBuffer, {
      contentType: audioFile.type || 'audio/mpeg',
      upsert: false,
    })

  if (storageError) {
    return NextResponse.json(
      { error: `Erro ao guardar ficheiro: ${storageError.message}` },
      { status: 500 }
    )
  }

  // Step 5: Create call_uploads row with status 'pending'
  const { data: uploadRow, error: insertError } = await supabase
    .from('call_uploads')
    .insert({
      team_id: teamId,
      storage_path: storagePath,
      status: 'pending',
    })
    .select('id')
    .single()

  if (insertError || !uploadRow) {
    // Clean up orphaned storage file before returning error
    void supabase.storage.from('call-audio').remove([storagePath])
    return NextResponse.json(
      { error: `Erro ao criar registo: ${insertError?.message}` },
      { status: 500 }
    )
  }

  // Step 6: Retornar 202 imediatamente — o cliente chama /api/calls/process/[id] para iniciar processamento
  return NextResponse.json(
    { upload_id: uploadRow.id, status: 'pending' },
    { status: 202 }
  )
}
