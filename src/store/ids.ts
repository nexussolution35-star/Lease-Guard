import type { EntityId, ISODate, ISODateTime } from '@/types'

/** Africa/Johannesburg is UTC+02:00 year-round (no daylight saving). */
const SAST_OFFSET_MINUTES = 120
const SAST_OFFSET_LABEL = '+02:00'

function randomSuffix(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 20)
  }
  // Fallback for environments without the Web Crypto API.
  let out = ''
  while (out.length < 20) out += Math.random().toString(36).slice(2)
  return out.slice(0, 20)
}

/** New entity id, e.g. `lease_3f9c2a1b7d4e5f6a8b9c`. */
export function generateId(prefix: string): EntityId {
  return `${prefix}_${randomSuffix()}`
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0')
}

/** ISO 8601 timestamp expressed in South African Standard Time, e.g. `2026-11-06T08:30:00+02:00`. */
export function nowISO(date: Date = new Date()): ISODateTime {
  const shifted = new Date(date.getTime() + SAST_OFFSET_MINUTES * 60_000)
  const y = shifted.getUTCFullYear()
  const mo = pad(shifted.getUTCMonth() + 1)
  const d = pad(shifted.getUTCDate())
  const h = pad(shifted.getUTCHours())
  const mi = pad(shifted.getUTCMinutes())
  const s = pad(shifted.getUTCSeconds())
  return `${y}-${mo}-${d}T${h}:${mi}:${s}${SAST_OFFSET_LABEL}`
}

/** Calendar date (`YYYY-MM-DD`) in South African Standard Time. */
export function todayISO(date: Date = new Date()): ISODate {
  return nowISO(date).slice(0, 10)
}
