// lib/phone.ts
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null
  // Remove tudo exceto dígitos e +
  const digits = raw.replace(/[^\d+]/g, '')
  // Remover prefixo PT se presente
  if (digits.startsWith('+351')) return digits.slice(4)
  if (digits.startsWith('351') && digits.length === 12) return digits.slice(3)
  // Retornar apenas dígitos
  return digits.replace(/\D/g, '') || null
}
