import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { normalizePhone } from '@/lib/phone'

export const maxDuration = 60

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

  const toInsert: Record<string, unknown>[] = []
  const errors: string[] = []
  let skipped = 0

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i])
    const full_name = cols[nameIdx]?.trim()
    if (!full_name) { errors.push(`Linha ${i + 1}: full_name em falta`); continue }

    const phone = normalizePhone(cols[phoneIdx]) ?? null
    const email = cols[emailIdx]?.trim() || null

    // Dedup: verificar se já existe lead com mesmo phone ou email
    if (phone || email) {
      const query = supabase.from('leads').select('id').eq('team_id', member.team_id)
      if (phone && email) {
        const { data: existing } = await query.or(`phone.eq.${phone},email.eq.${email}`)
        if (existing && existing.length > 0) { skipped++; continue }
      } else if (phone) {
        const { data: existing } = await query.eq('phone', phone)
        if (existing && existing.length > 0) { skipped++; continue }
      } else if (email) {
        const { data: existing } = await query.eq('email', email)
        if (existing && existing.length > 0) { skipped++; continue }
      }
    }

    const validStatuses = ['new', 'qualified', 'meeting', 'active', 'won', 'lost']
    const status = validStatuses.includes(cols[statusIdx]) ? cols[statusIdx] : 'new'

    toInsert.push({
      team_id: member.team_id,
      full_name,
      phone,
      email,
      source: cols[sourceIdx]?.trim() || null,
      status,
      notes: cols[notesIdx]?.trim() || null,
      score: parseInt(cols[scoreIdx]) || 0,
      urgency: parseInt(cols[urgencyIdx]) || 1,
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
    if (char === '"') {
      inQuotes = !inQuotes
    } else if (char === ',' && !inQuotes) {
      result.push(current)
      current = ''
    } else {
      current += char
    }
  }
  result.push(current)
  return result
}
