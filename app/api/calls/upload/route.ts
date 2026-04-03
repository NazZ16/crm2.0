import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { transcribeAudio } from '@/lib/whisper'
import { leadAgent } from '@/lib/agents/lead-agent'
import { callCoachAgent } from '@/lib/agents/call-coach-agent'

export const maxDuration = 120

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

async function runPipeline(
  uploadId: string,
  teamId: string,
  audioBuffer: Buffer,
  filename: string,
  userId: string
): Promise<void> {
  // Use service client for background pipeline (bypasses cookie context)
  const { createServiceClient } = await import('@/lib/supabase/server')
  const supabase = createServiceClient()

  try {
    // Step a: Transcribe
    const { text: transcriptText, duration_s } = await transcribeAudio(audioBuffer, filename)

    // Step b: Update row with transcript
    await supabase
      .from('call_uploads')
      .update({
        transcript_text: transcriptText,
        audio_duration_s: duration_s,
        whisper_model: 'whisper-1',
        status: 'analyzing',
        updated_at: new Date().toISOString(),
      })
      .eq('id', uploadId)

    // Step c: Run lead agent to extract data from transcript
    const agentOutput = await leadAgent.analyze({
      leadName: 'Lead (chamada)',
      conversationText: transcriptText,
      objective: 'Extrair número de telefone (campo crítico para deduplicação), nome completo, score e urgência desta chamada.',
    })

    const leadUpdates = agentOutput.lead_updates as unknown as {
      phone?: string
      score?: number
      urgency?: number
      summary?: string
    }

    const extractedPhone = leadUpdates.phone ?? null
    const extractedScore = leadUpdates.score ?? null
    const extractedUrgency = leadUpdates.urgency ?? null
    const extractedSummary = agentOutput.lead_updates.summary ?? null

    // Step d: Dedup by phone
    let leadId: string | null = null

    if (extractedPhone) {
      const { data: existingLead } = await supabase
        .from('leads')
        .select('id, full_name')
        .eq('team_id', teamId)
        .eq('phone', extractedPhone)
        .maybeSingle()

      if (existingLead) {
        leadId = existingLead.id
        await supabase
          .from('leads')
          .update({
            score: extractedScore,
            urgency: extractedUrgency,
            last_contact_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', leadId)
      }
    }

    if (!leadId) {
      const { data: newLead } = await supabase
        .from('leads')
        .insert({
          team_id: teamId,
          assigned_to: userId,
          full_name: 'Lead (chamada)',
          phone: extractedPhone,
          status: 'new',
          source: 'call_upload',
          score: extractedScore,
          urgency: extractedUrgency,
        })
        .select('id')
        .single()

      if (newLead) {
        leadId = newLead.id
        // Create empty lead profile
        await supabase.from('lead_profiles').insert({ lead_id: leadId })
      }
    }

    if (!leadId) {
      throw new Error('Falhou a criar ou encontrar lead')
    }

    // Step e: Get last 3 interaction summaries for coach context
    const { data: recentInteractions } = await supabase
      .from('interactions')
      .select('summary')
      .eq('lead_id', leadId)
      .eq('team_id', teamId)
      .not('summary', 'is', null)
      .order('occurred_at', { ascending: false })
      .limit(3)

    const summaries = (recentInteractions ?? [])
      .map((i: { summary: string | null }) => i.summary)
      .filter((s): s is string => s !== null)

    // Run coach agent
    const coachFeedback = await callCoachAgent.analyze(
      transcriptText,
      'Lead (chamada)',
      summaries
    )

    // Step f: Insert interaction record
    const interactionSummary = [
      extractedSummary,
      `Sentimento: ${coachFeedback.sentimento_lead}`,
    ]
      .filter(Boolean)
      .join(' | ')

    await supabase.from('interactions').insert({
      lead_id: leadId,
      team_id: teamId,
      type: 'call',
      raw_text: transcriptText,
      summary: interactionSummary,
      occurred_at: new Date().toISOString(),
    })

    // Step g: Create follow-up tasks if urgency >= 3
    if (extractedUrgency != null && extractedUrgency >= 3) {
      await createFollowUpSequence(supabase, teamId, leadId, userId)
    }

    // Step h: Update call_uploads row as done
    await supabase
      .from('call_uploads')
      .update({
        lead_id: leadId,
        coach_feedback: coachFeedback as unknown as Record<string, unknown>,
        status: 'done',
        processed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', uploadId)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await supabase
      .from('call_uploads')
      .update({
        status: 'failed',
        error: message,
        updated_at: new Date().toISOString(),
      })
      .eq('id', uploadId)
  }
}

async function createFollowUpSequence(
  supabase: ReturnType<typeof import('@/lib/supabase/server').createServiceClient>,
  teamId: string,
  leadId: string,
  userId: string
): Promise<void> {
  // Check for existing open follow-up tasks for this lead
  const { data: existingTasks } = await supabase
    .from('tasks')
    .select('id')
    .eq('team_id', teamId)
    .eq('lead_id', leadId)
    .eq('status', 'open')
    .limit(1)

  if (existingTasks && existingTasks.length > 0) {
    return // Already has open tasks — skip
  }

  const now = new Date()
  const tasks = [
    {
      team_id: teamId,
      lead_id: leadId,
      assigned_to: userId,
      title: 'Follow-up inicial — chamada recente',
      description: 'Contactar lead após chamada recebida. Urgência elevada.',
      due_at: new Date(now.getTime()).toISOString(),
      status: 'open' as const,
      priority: 'urgent' as const,
      created_by: 'agent' as const,
    },
    {
      team_id: teamId,
      lead_id: leadId,
      assigned_to: userId,
      title: 'Follow-up 3 dias — verificar interesse',
      description: 'Verificar interesse da lead após contacto inicial.',
      due_at: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      status: 'open' as const,
      priority: 'high' as const,
      created_by: 'agent' as const,
    },
    {
      team_id: teamId,
      lead_id: leadId,
      assigned_to: userId,
      title: 'Follow-up 7 dias — decisão final',
      description: 'Obter decisão final da lead ou reagendar.',
      due_at: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      status: 'open' as const,
      priority: 'medium' as const,
      created_by: 'agent' as const,
    },
  ]

  await supabase.from('tasks').insert(tasks)
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

  // Step 5: Create call_uploads row
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
    // Clean up orphaned storage file before returning error
    void supabase.storage.from('call-audio').remove([storagePath])
    return NextResponse.json(
      { error: `Erro ao criar registo: ${insertError?.message}` },
      { status: 500 }
    )
  }

  // Step 6: Return 202 immediately, fire-and-forget pipeline
  void runPipeline(uploadRow.id, teamId, audioBuffer, sanitizedFilename, user.id)

  return NextResponse.json(
    { upload_id: uploadRow.id, status: 'transcribing' },
    { status: 202 }
  )
}
