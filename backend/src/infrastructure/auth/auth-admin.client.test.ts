import { AuthApiError, AuthRetryableFetchError, AuthUnknownError } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'

import type { ServiceRoleClientFactory } from '../database/service-role-client.factory'
import { AuthAdminError, SupabaseAuthAdmin } from './auth-admin.client'

const USER = { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', email: 'thandi@example.co.za', email_confirmed_at: null }

function adminWith(admin: Record<string, unknown>): SupabaseAuthAdmin {
  return new SupabaseAuthAdmin({ get: () => ({ auth: { admin } }) } as unknown as ServiceRoleClientFactory)
}

describe('AuthAdminError', () => {
  it('retries network failures, 5xx, 408 and 429; never other 4xx', () => {
    const retryable = (error: ConstructorParameters<typeof AuthAdminError>[1]) => new AuthAdminError('op', error).retryable
    expect(retryable(new AuthRetryableFetchError('fetch failed', 0))).toBe(true)
    expect(retryable(new AuthApiError('Bad gateway', 502, undefined))).toBe(true)
    expect(retryable(new AuthApiError('Error sending invite email', 500, 'unexpected_failure'))).toBe(true)
    expect(retryable(new AuthApiError('timeout', 408, 'request_timeout'))).toBe(true)
    expect(retryable(new AuthApiError('email rate limit exceeded', 429, 'over_email_send_rate_limit'))).toBe(true)
    expect(retryable(new AuthUnknownError('unknown', null))).toBe(true)
    expect(retryable(new AuthApiError('invalid format', 400, 'validation_failed'))).toBe(false)
    expect(retryable(new AuthApiError('not admin', 403, 'not_admin'))).toBe(false)
    expect(retryable(new AuthApiError('Email address not authorized', 400, 'email_address_not_authorized'))).toBe(false)
  })

  it('names the operation, HTTP status and code', () => {
    expect(new AuthAdminError('Send invitation email', new AuthApiError('nope', 400, 'validation_failed')).message).toBe(
      'Send invitation email failed (HTTP 400, validation_failed): nope',
    )
  })
})

describe('SupabaseAuthAdmin', () => {
  it('invites with the redirect and the full name as user metadata', async () => {
    const inviteUserByEmail = vi.fn(async () => ({ data: { user: USER }, error: null }))
    const result = await adminWith({ inviteUserByEmail }).inviteUserByEmail(USER.email, {
      fullName: 'Thandi Nkosi',
      redirectTo: 'http://localhost:5173/auth/accept',
    })
    expect(result).toEqual({ kind: 'invited', user: { id: USER.id, email: USER.email, emailConfirmed: false } })
    expect(inviteUserByEmail).toHaveBeenCalledWith(USER.email, { redirectTo: 'http://localhost:5173/auth/accept', data: { full_name: 'Thandi Nkosi' } })
  })

  it('omits empty metadata', async () => {
    const inviteUserByEmail = vi.fn(async () => ({ data: { user: USER }, error: null }))
    await adminWith({ inviteUserByEmail }).inviteUserByEmail(USER.email, { fullName: null, redirectTo: 'https://app.example.co.za/auth/accept' })
    expect(inviteUserByEmail).toHaveBeenCalledWith(USER.email, { redirectTo: 'https://app.example.co.za/auth/accept' })
  })

  it('reports an existing user instead of failing', async () => {
    for (const code of ['email_exists', 'user_already_exists']) {
      const inviteUserByEmail = vi.fn(async () => ({ data: { user: null }, error: new AuthApiError('A user with this email address has already been registered', 422, code) }))
      await expect(adminWith({ inviteUserByEmail }).inviteUserByEmail(USER.email, { redirectTo: 'x' })).resolves.toEqual({ kind: 'exists' })
    }
  })

  it('throws AuthAdminError for other failures', async () => {
    const inviteUserByEmail = vi.fn(async () => ({ data: { user: null }, error: new AuthApiError('invalid', 400, 'validation_failed') }))
    await expect(adminWith({ inviteUserByEmail }).inviteUserByEmail(USER.email, { redirectTo: 'x' })).rejects.toBeInstanceOf(AuthAdminError)
  })

  it('returns null for an unknown user id', async () => {
    const getUserById = vi.fn(async () => ({ data: { user: null }, error: new AuthApiError('User not found', 404, 'user_not_found') }))
    await expect(adminWith({ getUserById }).getUserById(USER.id)).resolves.toBeNull()
    const confirmed = vi.fn(async () => ({ data: { user: { ...USER, email_confirmed_at: '2026-11-09T08:00:00Z' } }, error: null }))
    await expect(adminWith({ getUserById: confirmed }).getUserById(USER.id)).resolves.toMatchObject({ emailConfirmed: true })
  })

  it('pages through users to find one by email, ignoring letter case', async () => {
    const page = (n: number, count: number) => Array.from({ length: count }, (_, i) => ({ ...USER, id: `u-${n}-${i}`, email: `u${n}-${i}@example.co.za` }))
    const listUsers = vi.fn(async ({ page: n }: { page: number }) => ({
      data: { users: n === 1 ? page(1, 1000) : [...page(2, 10), { ...USER, email: 'Thandi@Example.co.za' }] },
      error: null,
    }))
    await expect(adminWith({ listUsers }).findUserByEmail(USER.email)).resolves.toMatchObject({ id: USER.id })
    expect(listUsers).toHaveBeenCalledTimes(2)
    expect(listUsers).toHaveBeenNthCalledWith(1, { page: 1, perPage: 1000 })
  })

  it('stops at the last page when nobody has the email', async () => {
    const listUsers = vi.fn(async () => ({ data: { users: [USER] }, error: null }))
    await expect(adminWith({ listUsers }).findUserByEmail('nobody@example.co.za')).resolves.toBeNull()
    expect(listUsers).toHaveBeenCalledTimes(1)
  })
})
