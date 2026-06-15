import { sha256 } from '@noble/hashes/sha2.js'

export function createContentHashUuid(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  const digest = sha256(bytes)
  const hex = [...digest.slice(0, 16)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-')
}
