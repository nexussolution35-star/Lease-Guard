import { describe, expect, it } from 'vitest'

import { whatsappNumberStatus } from './whatsappStatus'

describe('whatsappNumberStatus', () => {
  it('reads validated, not validated and opted out (opted out wins)', () => {
    expect(whatsappNumberStatus({ whatsappVerified: true, whatsappOptedOut: false })).toEqual({ label: 'Validated', tone: 'success' })
    expect(whatsappNumberStatus({ whatsappVerified: false, whatsappOptedOut: false })).toEqual({ label: 'Not validated', tone: 'warning' })
    expect(whatsappNumberStatus({ whatsappVerified: true, whatsappOptedOut: true })).toEqual({ label: 'Opted out', tone: 'neutral' })
  })
})
