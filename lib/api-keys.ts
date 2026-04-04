// lib/api-keys.ts
import { createHash, randomBytes } from 'crypto'

/** Gera uma API key aleatória no formato crm_<48 hex chars> */
export function generateApiKey(): string {
  const random = randomBytes(24).toString('hex')
  return `crm_${random}`
}

/** SHA-256 hash de uma key em plaintext */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

/** Primeiros 8 chars da key para identificação na UI */
export function keyPrefix(key: string): string {
  return key.slice(0, 8)
}
