import type { ISODateTime } from '@leaseguard/domain'

/** Build an SAST timestamp from a `YYYY-MM-DDTHH:mm` local time. */
export function ts(local: `${number}-${number}-${number}T${number}:${number}`): ISODateTime {
  return `${local}:00+02:00`
}

/** Round rands to 2 decimal places. */
export function r2(value: number): number {
  return Math.round(value * 100) / 100
}

/** Deterministic fake SHA-256 digest (64 hex chars) derived from a label. */
export function fakeSha256(label: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < label.length; i += 1) {
    const c = label.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ c, 0x85ebca6b) >>> 0
  }
  let out = ''
  for (let i = 0; i < 8; i += 1) {
    h1 = Math.imul(h1 ^ (h1 >>> 15), 0x2c1b3c6d) >>> 0
    h2 = Math.imul(h2 ^ (h2 >>> 13), 0x297a2d39) >>> 0
    out += (h1 ^ h2).toString(16).padStart(8, '0')
  }
  return out
}
