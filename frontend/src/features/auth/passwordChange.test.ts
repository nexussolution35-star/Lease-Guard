import { describe, expect, it } from 'vitest'

import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  newPasswordErrorFrom,
  PASSWORD_LINK_UNAVAILABLE,
  passwordLinkErrorFrom,
  setPasswordSchema,
} from './passwordChange'

function providerError(fields: { status?: number; code?: string }, message = 'provider detail'): Error & { status?: number; code?: string } {
  return Object.assign(new Error(message), fields)
}

describe('setPasswordSchema', () => {
  const issues = (values: { newPassword: string; confirmPassword: string }) =>
    setPasswordSchema.safeParse(values).error?.issues.map((i) => [i.path.join('.'), i.message])

  it('accepts a confirmed password of 8 to 72 characters', () => {
    expect(MIN_PASSWORD_LENGTH).toBeGreaterThanOrEqual(8)
    expect(issues({ newPassword: 'new-password-1', confirmPassword: 'new-password-1' })).toBeUndefined()
    const longest = 'x'.repeat(MAX_PASSWORD_LENGTH)
    expect(issues({ newPassword: longest, confirmPassword: longest })).toBeUndefined()
  })

  it('rejects a short, too long or unconfirmed password', () => {
    expect(issues({ newPassword: 'short', confirmPassword: 'short' })).toEqual([['newPassword', 'Use at least 8 characters']])
    const tooLong = 'x'.repeat(MAX_PASSWORD_LENGTH + 1)
    expect(issues({ newPassword: tooLong, confirmPassword: tooLong })).toEqual([['newPassword', 'Use at most 72 characters']])
    expect(issues({ newPassword: 'new-password-1', confirmPassword: 'something-else' })).toEqual([['confirmPassword', 'The passwords do not match']])
  })
})

describe('newPasswordErrorFrom', () => {
  it('maps Supabase update errors to safe messages', () => {
    expect(newPasswordErrorFrom(providerError({ status: 422, code: 'same_password' })).field).toBe('newPassword')
    expect(newPasswordErrorFrom(providerError({ status: 422, code: 'weak_password' })).message).toMatch(/too weak/)
    expect(newPasswordErrorFrom(providerError({ status: 500 })).message).not.toContain('provider detail')
  })

  it('asks for a new link when Supabase wants a fresh session (secure password change)', () => {
    const error = newPasswordErrorFrom(providerError({ status: 400, code: 'reauthentication_needed' }))
    expect(error.field).toBeNull()
    expect(error.message).toBe('For your security, this link has expired. Request a new password link and try again.')
  })
})

describe('passwordLinkErrorFrom', () => {
  it('reports the per-address cooldown with the seconds Supabase gave', () => {
    const error = passwordLinkErrorFrom(
      providerError({ status: 429, code: 'over_email_send_rate_limit' }, 'For security purposes, you can only request this after 42 seconds.'),
    )
    expect(error.retryAfterSeconds).toBe(42)
    expect(error.message).toBe('A link was sent moments ago. You can request another in 42 seconds.')
    expect(passwordLinkErrorFrom(providerError({ status: 429 }, 'only request this after 0 seconds.')).message).toMatch(/in 1 second\.$/)
  })

  it('reports the hourly email limit without a countdown', () => {
    const error = passwordLinkErrorFrom(providerError({ status: 429, code: 'over_email_send_rate_limit' }, 'Email rate limit exceeded'))
    expect(error.retryAfterSeconds).toBeNull()
    expect(error.message).toBe('Too many emails were sent recently. Wait a few minutes and try again.')
  })

  it('never shows raw provider errors', () => {
    const error = passwordLinkErrorFrom(providerError({ status: 500 }))
    expect(error.message).toBe(PASSWORD_LINK_UNAVAILABLE)
    expect(error.retryAfterSeconds).toBeNull()
  })
})
