import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js'
import { UnrecoverableError } from 'bullmq'
import { describe, expect, it, vi } from 'vitest'

import type { WorkerEnv } from '../../config/env'
import { type AuthAdmin, AuthAdminError, type AuthUserSummary, type InviteResult } from '../../infrastructure/auth/auth-admin.client'
import { callsTo, fakeDb, type FakeResult, type RecordedQuery } from '../../common/testing/fake-db.test-helpers'
import { clientsFor, COMPANY, eqValue, fixedClock, isWrite, unusedRuntime } from '../workers.test-helpers'
import { invitationRedirect, UserInvitationProcessor } from './user-invitation.processor'

const INVITATION = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const NEW_USER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const EXISTING_USER = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const EMAIL = 'thandi@example.co.za'
const NOW = '2026-11-09T08:00:00.000Z'
const REDIRECT = `https://app.example.co.za/auth/accept?invitation=${INVITATION}`

const invitationRow = {
  id: INVITATION,
  company_id: COMPANY,
  email: EMAIL,
  full_name: 'Thandi Nkosi',
  role: 'property_manager',
  status: 'pending',
  invited_user_id: null,
}

const unconfirmed: AuthUserSummary = { id: EXISTING_USER, email: EMAIL, emailConfirmed: false }
const confirmed: AuthUserSummary = { id: EXISTING_USER, email: EMAIL, emailConfirmed: true }

type Row = Record<string, unknown>
type DbErrorShape = NonNullable<FakeResult['error']>

interface Options {
  invitation?: Row | null
  /** The invitation as re-read after a status update matched nothing. */
  reloaded?: Row | null
  reopenError?: DbErrorShape
  /** Rows returned by the failed → pending reset (default: the reopened invitation). */
  reopenRows?: Row[]
  /** Rows returned by the final status update (default: the invitation). */
  statusUpdateRows?: Row[]
  statusUpdateError?: DbErrorShape
  invite?: (email: string) => Promise<InviteResult>
  /** getUserById(invited_user_id). */
  authUser?: AuthUserSummary | null
  /** findUserByEmail answers, in call order (the last one repeats). */
  foundByEmail?: (AuthUserSummary | null)[]
}

const updateOf = (query: RecordedQuery): Row | undefined => callsTo(query, 'update')[0]?.[0] as Row | undefined
const ok = (data: unknown): FakeResult => ({ data, error: null })
const failed = (error: DbErrorShape): FakeResult => ({ data: null, error })

function harness(options: Options = {}) {
  const invitation = options.invitation === undefined ? invitationRow : options.invitation
  let invitationReads = 0
  const db = fakeDb((query) => {
    // The worker never reads or writes memberships or profiles: only the invitation itself.
    if (query.table !== 'company_invitations') throw new Error(`unexpected table ${query.table}`)
    const update = updateOf(query)
    if (update?.status === 'pending') return options.reopenError ? failed(options.reopenError) : ok(options.reopenRows ?? [{ ...invitation, ...update }])
    if (update?.status === 'failed') return ok([{ id: INVITATION }])
    if (update) return options.statusUpdateError ? failed(options.statusUpdateError) : ok(options.statusUpdateRows ?? [{ id: INVITATION }])
    invitationReads += 1
    return ok(invitationReads === 1 ? invitation : (options.reloaded ?? invitation))
  })
  const inviteUserByEmail = vi.fn(
    options.invite ?? (async (): Promise<InviteResult> => ({ kind: 'invited', user: { id: NEW_USER, email: EMAIL, emailConfirmed: false } })),
  )
  const getUserById = vi.fn(async (): Promise<AuthUserSummary | null> => options.authUser ?? null)
  const answers = options.foundByEmail ?? [null]
  let lookups = 0
  const findUserByEmail = vi.fn(async (): Promise<AuthUserSummary | null> => answers[Math.min(lookups++, answers.length - 1)] ?? null)
  const auth: AuthAdmin = { inviteUserByEmail, getUserById, findUserByEmail }
  const processor = new UserInvitationProcessor(unusedRuntime, clientsFor(db.client), auth, fixedClock(NOW), {
    WEB_APP_URL: 'https://app.example.co.za',
  } as WorkerEnv)
  return { processor, queries: db.queries, inviteUserByEmail, getUserById, findUserByEmail }
}

const payload = { companyId: COMPANY, invitationId: INVITATION }
const firstAttempt = { attempt: 1, maxAttempts: 5 }
const lastAttempt = { attempt: 5, maxAttempts: 5 }

const invitationUpdates = (queries: RecordedQuery[]) => queries.filter((q) => q.table === 'company_invitations' && isWrite(q))

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('expected the promise to reject')
}

describe('invitationRedirect', () => {
  it('links to the accept page with the invitation id', () => {
    expect(invitationRedirect('https://app.example.co.za', INVITATION)).toBe(REDIRECT)
    expect(invitationRedirect('https://app.example.co.za/', INVITATION)).toBe(REDIRECT)
  })
})

describe('UserInvitationProcessor', () => {
  it('invites a new user and marks the invitation sent, without creating a membership', async () => {
    const { processor, queries, inviteUserByEmail, findUserByEmail } = harness()
    await expect(processor.process(payload, firstAttempt)).resolves.toEqual({ outcome: 'sent', userId: NEW_USER, emailed: true })
    expect(findUserByEmail).toHaveBeenCalledWith(EMAIL)
    expect(inviteUserByEmail).toHaveBeenCalledWith(EMAIL, { fullName: 'Thandi Nkosi', redirectTo: REDIRECT })

    const [statusUpdate, ...others] = invitationUpdates(queries)
    expect(others).toEqual([])
    expect(updateOf(statusUpdate!)).toEqual({ status: 'sent', invited_user_id: NEW_USER, failure_reason: null, sent_at: NOW })
    // Conditional on the state the run started from, so a concurrent revoke is never overwritten.
    expect(callsTo(statusUpdate!, 'eq')).toEqual([
      ['company_id', COMPANY],
      ['id', INVITATION],
      ['status', 'pending'],
    ])
    expect(queries.every((q) => q.table === 'company_invitations')).toBe(true)
  })

  it('sends the invitation email again to an existing user who has not confirmed their email', async () => {
    const { processor, queries, inviteUserByEmail } = harness({
      foundByEmail: [unconfirmed],
      invite: async () => ({ kind: 'invited', user: unconfirmed }),
    })
    await expect(processor.process(payload, firstAttempt)).resolves.toEqual({ outcome: 'sent', userId: EXISTING_USER, emailed: true })
    expect(inviteUserByEmail).toHaveBeenCalledWith(EMAIL, { fullName: 'Thandi Nkosi', redirectTo: REDIRECT })
    expect(updateOf(invitationUpdates(queries)[0]!)).toEqual({ status: 'sent', invited_user_id: EXISTING_USER, failure_reason: null, sent_at: NOW })
  })

  it('does not email an existing confirmed user and still records the invitation as sent (never accepted)', async () => {
    const { processor, queries, inviteUserByEmail } = harness({ foundByEmail: [confirmed] })
    await expect(processor.process(payload, firstAttempt)).resolves.toEqual({ outcome: 'sent', userId: EXISTING_USER, emailed: false })
    expect(inviteUserByEmail).not.toHaveBeenCalled()
    expect(updateOf(invitationUpdates(queries)[0]!)).toEqual({ status: 'sent', invited_user_id: EXISTING_USER, failure_reason: null, sent_at: NOW })
    expect(queries.every((q) => q.table === 'company_invitations')).toBe(true)
  })

  it('looks the user up again when Auth reports the email exists (created or confirmed meanwhile)', async () => {
    const { processor, findUserByEmail } = harness({ foundByEmail: [null, confirmed], invite: async () => ({ kind: 'exists' }) })
    await expect(processor.process(payload, firstAttempt)).resolves.toEqual({ outcome: 'sent', userId: EXISTING_USER, emailed: false })
    expect(findUserByEmail).toHaveBeenCalledTimes(2)
  })

  it('retries when Auth reports the email exists but the user cannot be found yet', async () => {
    const { processor, queries } = harness({ invite: async () => ({ kind: 'exists' }), foundByEmail: [null] })
    const error = await rejection(processor.process(payload, firstAttempt))
    expect(error).not.toBeInstanceOf(UnrecoverableError)
    expect(invitationUpdates(queries)).toEqual([])
  })

  it.each(['accepted', 'revoked', 'declined'])('skips a %s invitation without any write or email', async (status) => {
    const { processor, queries, inviteUserByEmail, findUserByEmail } = harness({ invitation: { ...invitationRow, status } })
    await expect(processor.process(payload, firstAttempt)).resolves.toEqual({ outcome: 'skipped', status })
    expect(inviteUserByEmail).not.toHaveBeenCalled()
    expect(findUserByEmail).not.toHaveBeenCalled()
    expect(queries.filter(isWrite)).toEqual([])
  })

  it('fails permanently when the invitation does not exist in the company', async () => {
    const { processor, queries, inviteUserByEmail } = harness({ invitation: null })
    expect(await rejection(processor.process(payload, firstAttempt))).toBeInstanceOf(UnrecoverableError)
    expect(inviteUserByEmail).not.toHaveBeenCalled()
    expect(queries.filter(isWrite)).toEqual([])
  })

  it('resets a failed invitation that was resent to pending, then sends it', async () => {
    const { processor, queries, inviteUserByEmail } = harness({ invitation: { ...invitationRow, status: 'failed' } })
    await expect(processor.process(payload, firstAttempt)).resolves.toMatchObject({ outcome: 'sent', emailed: true })
    expect(inviteUserByEmail).toHaveBeenCalledTimes(1)
    const [reopen, sent] = invitationUpdates(queries)
    expect(updateOf(reopen!)).toEqual({ status: 'pending', failure_reason: null })
    expect(callsTo(reopen!, 'eq')).toContainEqual(['status', 'failed'])
    expect(callsTo(sent!, 'eq')).toContainEqual(['status', 'pending'])
  })

  it('keeps a failed invitation failed when another open invitation for the email exists', async () => {
    const { processor, queries, inviteUserByEmail } = harness({
      invitation: { ...invitationRow, status: 'failed' },
      reopenError: { code: '23505', message: 'duplicate key value violates unique constraint "company_invitations_open_email_idx"' },
    })
    expect(await rejection(processor.process(payload, firstAttempt))).toBeInstanceOf(UnrecoverableError)
    expect(inviteUserByEmail).not.toHaveBeenCalled()
    expect(updateOf(invitationUpdates(queries)[1]!)).toEqual({
      status: 'failed',
      failure_reason: `Another open invitation for ${EMAIL} already exists in this company`,
    })
  })

  it('retries a failed invitation that is no longer failed when the reset runs', async () => {
    const { processor, queries, inviteUserByEmail } = harness({ invitation: { ...invitationRow, status: 'failed' }, reopenRows: [] })
    const error = await rejection(processor.process(payload, firstAttempt))
    expect(error).not.toBeInstanceOf(UnrecoverableError)
    expect(String(error)).toMatch(/no longer failed/)
    expect(inviteUserByEmail).not.toHaveBeenCalled()
    expect(invitationUpdates(queries)).toHaveLength(1)
  })

  it('resends a sent invitation to its user who has not confirmed yet, found by the recorded user id', async () => {
    const { processor, queries, inviteUserByEmail, getUserById, findUserByEmail } = harness({
      invitation: { ...invitationRow, status: 'sent', invited_user_id: EXISTING_USER },
      authUser: unconfirmed,
      invite: async () => ({ kind: 'invited', user: unconfirmed }),
    })
    await expect(processor.process(payload, firstAttempt)).resolves.toEqual({ outcome: 'sent', userId: EXISTING_USER, emailed: true })
    expect(getUserById).toHaveBeenCalledWith(EXISTING_USER)
    expect(findUserByEmail).not.toHaveBeenCalled()
    expect(inviteUserByEmail).toHaveBeenCalledTimes(1)
    const [update] = invitationUpdates(queries)
    expect(updateOf(update!)).toEqual({ status: 'sent', invited_user_id: EXISTING_USER, failure_reason: null, sent_at: NOW })
    expect(callsTo(update!, 'eq')).toContainEqual(['status', 'sent'])
  })

  it('does not email a confirmed user on resend, but stamps sent_at anyway so it reveals nothing', async () => {
    const { processor, queries, inviteUserByEmail } = harness({
      invitation: { ...invitationRow, status: 'sent', invited_user_id: EXISTING_USER },
      authUser: confirmed,
    })
    await expect(processor.process(payload, firstAttempt)).resolves.toEqual({ outcome: 'sent', userId: EXISTING_USER, emailed: false })
    expect(inviteUserByEmail).not.toHaveBeenCalled()
    expect(updateOf(invitationUpdates(queries)[0]!)).toEqual({ status: 'sent', invited_user_id: EXISTING_USER, failure_reason: null, sent_at: NOW })
  })

  it('ignores a recorded user whose email no longer matches and looks the email up instead', async () => {
    const { processor, findUserByEmail, inviteUserByEmail } = harness({
      invitation: { ...invitationRow, status: 'sent', invited_user_id: EXISTING_USER },
      authUser: { ...confirmed, email: 'someone.else@example.co.za' },
      foundByEmail: [null],
    })
    await expect(processor.process(payload, firstAttempt)).resolves.toEqual({ outcome: 'sent', userId: NEW_USER, emailed: true })
    expect(findUserByEmail).toHaveBeenCalledWith(EMAIL)
    expect(inviteUserByEmail).toHaveBeenCalledTimes(1)
  })

  it('looks the email up when the recorded user no longer exists', async () => {
    const { processor, findUserByEmail } = harness({
      invitation: { ...invitationRow, status: 'sent', invited_user_id: EXISTING_USER },
      authUser: null,
      foundByEmail: [confirmed],
    })
    await expect(processor.process(payload, firstAttempt)).resolves.toMatchObject({ outcome: 'sent', emailed: false })
    expect(findUserByEmail).toHaveBeenCalledTimes(1)
  })

  it('marks the invitation failed without retrying when Supabase Auth refuses the invitation', async () => {
    const refused = new AuthAdminError('Send invitation email', new AuthApiError('Unable to validate email address: invalid format', 400, 'validation_failed'))
    const { processor, queries } = harness({
      invite: async () => {
        throw refused
      },
    })
    const error = await rejection(processor.process(payload, firstAttempt))
    expect(error).toBeInstanceOf(UnrecoverableError)
    const [markFailed] = invitationUpdates(queries)
    expect(updateOf(markFailed!)).toEqual({ status: 'failed', failure_reason: refused.message })
    expect(callsTo(markFailed!, 'in')).toEqual([['status', ['pending', 'failed']]])
  })

  it('retries transient Auth failures and marks the invitation failed only on the last attempt', async () => {
    const outage = new AuthAdminError('Send invitation email', new AuthRetryableFetchError('fetch failed', 0))
    const rateLimited = new AuthAdminError('Send invitation email', new AuthApiError('email rate limit exceeded', 429, 'over_email_send_rate_limit'))
    for (const transient of [outage, rateLimited]) {
      const early = harness({
        invite: async () => {
          throw transient
        },
      })
      expect(await rejection(early.processor.process(payload, firstAttempt))).toBe(transient)
      expect(invitationUpdates(early.queries)).toEqual([])

      const last = harness({
        invite: async () => {
          throw transient
        },
      })
      expect(await rejection(last.processor.process(payload, lastAttempt))).toBeInstanceOf(UnrecoverableError)
      expect(updateOf(invitationUpdates(last.queries)[0]!)).toEqual({
        status: 'failed',
        failure_reason: `Sending the invitation failed after 5 attempts: ${transient.message}`,
      })
    }
  })

  it('retries a transient database failure', async () => {
    const { processor, queries } = harness({ statusUpdateError: { code: '57014', message: 'canceling statement due to statement timeout' } })
    const error = await rejection(processor.process(payload, firstAttempt))
    expect(error).not.toBeInstanceOf(UnrecoverableError)
    expect(invitationUpdates(queries).filter((q) => updateOf(q)?.status === 'failed')).toEqual([])
  })

  it('fails permanently on a refused status update (guard trigger)', async () => {
    const { processor, queries } = harness({ statusUpdateError: { code: 'P0001', message: 'invalid invitation status change' } })
    expect(await rejection(processor.process(payload, firstAttempt))).toBeInstanceOf(UnrecoverableError)
    expect(invitationUpdates(queries).some((q) => updateOf(q)?.status === 'failed')).toBe(true)
  })

  it('leaves a resent sent invitation sent when the resend fails permanently', async () => {
    const { processor, queries } = harness({
      invitation: { ...invitationRow, status: 'sent', invited_user_id: EXISTING_USER },
      authUser: unconfirmed,
      invite: async () => {
        throw new AuthAdminError('Send invitation email', new AuthApiError('Email address not authorized', 400, 'email_address_not_authorized'))
      },
    })
    expect(await rejection(processor.process(payload, firstAttempt))).toBeInstanceOf(UnrecoverableError)
    // The failure update only applies to pending/failed invitations, so a sent one keeps its status.
    expect(callsTo(invitationUpdates(queries)[0]!, 'in')).toEqual([['status', ['pending', 'failed']]])
  })

  it.each(['revoked', 'declined', 'accepted'])('leaves an invitation %s while it was being sent alone', async (status) => {
    const { processor, queries } = harness({ statusUpdateRows: [], reloaded: { ...invitationRow, status } })
    await expect(processor.process(payload, firstAttempt)).resolves.toEqual({ outcome: 'skipped', status })
    expect(invitationUpdates(queries)).toHaveLength(1)
    expect(queries.every((q) => q.table === 'company_invitations')).toBe(true)
  })

  it('retries when the invitation changed in another way while it was being sent', async () => {
    const { processor } = harness({ statusUpdateRows: [], reloaded: { ...invitationRow, status: 'failed' } })
    const error = await rejection(processor.process(payload, firstAttempt))
    expect(error).not.toBeInstanceOf(UnrecoverableError)
    expect(String(error)).toMatch(/changed from pending to failed/)
  })

  it('reads and writes the invitation only with the job company filter', async () => {
    const { processor, queries } = harness({ statusUpdateRows: [], reloaded: { ...invitationRow, status: 'revoked' } })
    await processor.process(payload, firstAttempt)
    for (const query of queries) expect(eqValue(query, 'company_id')).toBe(COMPANY)
  })
})
