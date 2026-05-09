// lib/contact-links.ts
// Helpers para construir links de envio rapido via WhatsApp e email.
// Usado pelos botoes "Enviar via WhatsApp" / "Enviar via Email" nos drafts da AI.

/**
 * Limpa um texto antes de o meter num link wa.me ou mailto:.
 * - Remove o replacement character U+FFFD (aparece quando UTF-8 foi corrompido em algum
 *   ponto da pipeline; com isto pelo menos nao aparece "??" para o cliente).
 * - Remove surrogates orfaos (metade de um par UTF-16 que nao tem o outro lado).
 * - Colapsa whitespaces multiplos em um.
 */
function sanitizeMessage(text: string): string {
  return text
    .replace(/�/g, '') // replacement char
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '') // high surrogate sem low
    .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '') // low surrogate sem high
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Constroi um link wa.me com texto pre-preenchido.
 *
 * Formato wa.me: https://wa.me/{numero-com-indicativo-sem-+}?text={url-encoded}
 *
 * Aceita numeros em varios formatos comuns em PT:
 *   - +351 912 345 678 -> 351912345678 (OK)
 *   - 351912345678     -> 351912345678 (OK)
 *   - 912 345 678      -> 351912345678 (auto-prefix PT)
 *   - 21 234 5678      -> 351212345678 (auto-prefix PT, fixo)
 *
 * Para numeros estrangeiros assume que ja vem com indicativo internacional.
 * Devolve null se o numero for invalido (menos de 9 digitos significativos).
 */
export function buildWaLink(phone: string | null | undefined, body: string): string | null {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  if (digits.length < 9) return null

  let formatted = digits
  // Se tem exactamente 9 digitos e comeca por 2 (fixo) ou 9 (movel), adiciona 351 (PT).
  if (digits.length === 9 && (digits.startsWith('9') || digits.startsWith('2'))) {
    formatted = '351' + digits
  }
  // Se tem 11 digitos e comeca por 351 sem o leading "+", deixa estar.
  // Outros formatos: assume-se que o user ja meteu indicativo correcto.

  return `https://wa.me/${formatted}?text=${encodeURIComponent(sanitizeMessage(body))}`
}

/**
 * Constroi um link mailto: com subject e body pre-preenchidos.
 * Devolve null se o email for vazio ou claramente invalido.
 */
export function buildMailtoLink(
  email: string | null | undefined,
  subject: string | null | undefined,
  body: string
): string | null {
  if (!email) return null
  const trimmed = email.trim()
  if (!trimmed.includes('@') || trimmed.length < 5) return null

  const params: string[] = []
  if (subject && subject.trim().length > 0) {
    params.push(`subject=${encodeURIComponent(sanitizeMessage(subject))}`)
  }
  if (body && body.length > 0) {
    params.push(`body=${encodeURIComponent(sanitizeMessage(body))}`)
  }

  return `mailto:${trimmed}${params.length > 0 ? '?' + params.join('&') : ''}`
}
