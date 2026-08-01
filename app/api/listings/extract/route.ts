import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { extractListingFromHtml } from '@/lib/listing-extractor'

const extractSchema = z.object({
  raw_html: z.string().min(1).max(500_000),
})

// Extração determinística (regex, zero custo) — não escreve na BD.
// O utilizador revê/edita o resultado no formulário antes de guardar.
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const body = await request.json()
  const parsed = extractSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const result = extractListingFromHtml(parsed.data.raw_html)
  return NextResponse.json(result)
}
