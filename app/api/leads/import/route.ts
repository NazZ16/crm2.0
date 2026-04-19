import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { normalizePhone } from '@/lib/phone'

export const maxDuration = 60

// Issue 4 — CSV injection: prefixar campos que começam com caracteres perigosos
function sanitizeCsvField(val: string | null | undefined): string | null {
  if (!val) return null
  const s = val.trim()
  return /^[=+\-@|]/.test(s) ? `'${s}` : s
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: member } = await supabase
    .from('team_members')
    .select('team_id, role')
    .eq('user_id', user.id)
    .single()

  if (!member) return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
  if (member.role === 'viewer') return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })

  const formData = await request.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'Ficheiro em falta' }, { status: 400 })

  // Issue 5 — Limite de tamanho do ficheiro
  if (file.size > 5 * 1024 * 1024) {
    return NextResponse.json({ error: 'Ficheiro demasiado grande (máx 5 MB)' }, { status: 413 })
  }

  const text = await file.text()
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  if (lines.length < 2) return NextResponse.json({ error: 'CSV vazio ou sem dados' }, { status: 400 })

  // Parse cabeçalho
  const headers = parseCSVLine(lines[0])
  const nameIdx = headers.indexOf('full_name')
  if (nameIdx === -1) return NextResponse.json({ error: 'Coluna full_name obrigatória' }, { status: 400 })

  const phoneIdx = headers.indexOf('phone')
  const emailIdx = headers.indexOf('email')
  const sourceIdx = headers.indexOf('source')
  const statusIdx = headers.indexOf('status')
  const notesIdx = headers.indexOf('notes')
  const scoreIdx = headers.indexOf('score')
  const urgencyIdx = headers.indexOf('urgency')

  // Issue 1 — Dedup em memória: recolher todos os phones/emails do CSV antes do loop
  const rawPhones = lines.slice(1)
    .map(l => normalizePhone(parseCSVLine(l)[phoneIdx]))
    .filter((p): p is string => !!p)
  const rawEmails = lines.slice(1)
    .map(l => parseCSVLine(l)[emailIdx]?.trim())
    .filter((e): e is string => !!e)

  const existingPhones = new Set<string>()
  const existingEmails = new Set<string>()

  if (rawPhones.length > 0) {
    const { data } = await supabase
      .from('leads')
      .select('phone')
      .eq('team_id', member.team_id)
      .in('phone', rawPhones)
    data?.forEach(r => r.phone && existingPhones.add(r.phone))
  }
  if (rawEmails.length > 0) {
    const { data } = await supabase
      .from('leads')
      .select('email')
      .eq('team_id', member.team_id)
      .in('email', rawEmails)
    data?.forEach(r => r.email && existingEmails.add(r.email))
  }

  const toInsert: Record<string, unknown>[] = []
  const errors: string[] = []
  let skipped = 0

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i])
    const full_name = cols[nameIdx]?.trim()
    if (!full_name) { errors.push(`Linha ${i + 1}: full_name em falta`); continue }

    const phone = normalizePhone(cols[phoneIdx]) ?? null
    const email = cols[emailIdx]?.trim() || null

    // Issue 1 — Verificação de duplicados em memória (sem query por linha)
    if ((phone && existingPhones.has(phone)) || (email && existingEmails.has(email))) {
      skipped++
      continue
    }

    const validStatuses = ['new', 'qualified', 'meeting', 'active', 'won', 'lost']
    const status = validStatuses.includes(cols[statusIdx]) ? cols[statusIdx] : 'new'

    // Issue 3 — parseInt anti-padrão: usar Number.isFinite para distinguir 0 de NaN
    const rawScore = Number(cols[scoreIdx])
    const rawUrgency = Number(cols[urgencyIdx])

    toInsert.push({
      team_id: member.team_id,
      // Issue 4 — sanitizar campos susceptíveis a CSV injection
      full_name: sanitizeCsvField(cols[nameIdx]) ?? full_name,
      phone,
      email,
      source: sanitizeCsvField(cols[sourceIdx]),
      status,
      notes: sanitizeCsvField(cols[notesIdx]),
      score: Number.isFinite(rawScore) ? rawScore : 0,
      urgency: Number.isFinite(rawUrgency) ? rawUrgency : 1,
    })
  }

  // Insert em batches de 50
  let imported = 0
  for (let i = 0; i < toInsert.length; i += 50) {
    const batch = toInsert.slice(i, i + 50)
    const { error } = await supabase.from('leads').insert(batch)
    if (error) {
      errors.push(`Batch ${Math.floor(i / 50) + 1}: ${error.message}`)
    } else {
      imported += batch.length
    }
  }

  return NextResponse.json({ imported, skipped, errors })
}

function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    // Issue 6 — Tratar "" escapadas correctamente dentro de campos quoted
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++ // saltar a próxima aspas
      } else {
        inQuotes = !inQuotes
      }
    } else if (char === ',' && !inQuotes) {
      // Issue 2 — trimEnd() para remover \r residual de \r\n em campos quoted
      result.push(current.trimEnd())
      current = ''
    } else {
      current += char
    }
  }
  // Issue 2 — trimEnd() também no valor final
  result.push(current.trimEnd())
  return result
}
