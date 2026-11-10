import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

const SIGNATURE = /^sha256=([0-9a-f]{64})$/i

/**
 * Whether `header` (Meta's `X-Hub-Signature-256: sha256=<hex>`) is the HMAC-SHA256 of the raw request bytes
 * keyed with the app secret. Compared in constant time; a missing or malformed header is false. Checked before
 * the body is parsed, so nothing Meta did not sign is ever read.
 */
export function isValidMetaSignature(rawBody: Buffer, header: string | undefined, appSecret: string): boolean {
  const match = header === undefined ? null : SIGNATURE.exec(header.trim())
  if (!match?.[1] || appSecret === '') return false
  const expected = createHmac('sha256', appSecret).update(rawBody).digest()
  const given = Buffer.from(match[1], 'hex')
  return given.length === expected.length && timingSafeEqual(given, expected)
}

/** Whether `given` equals `expected`, in constant time (the verify token of Meta's handshake). */
export function isSameSecret(given: string, expected: string): boolean {
  // Hashing first gives equal lengths, so the comparison does not reveal the expected length.
  const a = createHash('sha256').update(given).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b) && expected !== ''
}

/** Hex SHA-256 of the raw body: the payload's identity (job id, unique key of the stored event). */
export function payloadSha256(rawBody: Buffer): string {
  return createHash('sha256').update(rawBody).digest('hex')
}
