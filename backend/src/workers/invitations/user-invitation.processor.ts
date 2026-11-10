import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common'
import type { EntityId } from '@leaseguard/domain'
import { UnrecoverableError } from 'bullmq'

import type { WorkerEnv } from '../../config/env'
import { WORKER_ENV } from '../../config/tokens'
import { AuthAdminError, SupabaseAuthAdmin, type AuthAdmin, type AuthUserSummary } from '../../infrastructure/auth/auth-admin.client'
import type { Tables } from '../../infrastructure/database/database.types'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import { ServiceRoleClientFactory } from '../../infrastructure/database/service-role-client.factory'
import type { JobPayloads } from '../../infrastructure/queues/queue-registry'
import { isFinalAttempt, type JobAttempt, ProcessorRuntime } from '../jobs/processor-runtime'
import { Clock } from '../shared/clock'
import { unwrap, WorkerDatabaseError } from '../shared/db'

type InvitationRow = Pick<
  Tables<'company_invitations'>,
  'id' | 'company_id' | 'email' | 'full_name' | 'role' | 'status' | 'invited_user_id'
>

const INVITATION_COLUMNS = 'id, company_id, email, full_name, role, status, invited_user_id'

/** Path of the web app page an invitation link lands on (frontend contract). */
export const ACCEPT_INVITATION_PATH = '/auth/accept'

/** Invitations the worker never sends: the invitee answered, or an admin withdrew it. */
const CLOSED_STATUSES = new Set(['accepted', 'revoked', 'declined'])

export type InvitationOutcome =
  /** Accepted, declined or revoked invitations are left alone. */
  | { outcome: 'skipped'; status: string }
  | { outcome: 'sent'; userId: EntityId; emailed: boolean }

/**
 * Postgres errors that will not go away on retry: check/foreign-key violations, invalid input, a
 * privilege refusal and guard-trigger exceptions.
 */
const PERMANENT_DB_CODES = new Set(['23503', '23514', '22P02', '42501', 'P0001'])

/** The invitation cannot be sent; it is marked failed with this reason and never retried. */
export class PermanentInvitationError extends Error {}

/** An invitation status update matched no row because the invitation changed concurrently. */
class InvitationChangedError extends Error {}

/** The invitation link: the accept page carries the invitation id so the app can accept that one. */
export function invitationRedirect(webAppUrl: string, invitationId: EntityId): string {
  return `${webAppUrl.replace(/\/+$/, '')}${ACCEPT_INVITATION_PATH}?invitation=${encodeURIComponent(invitationId)}`
}

/**
 * Sends one company invitation (queue `user-invitations`) with the service role. It NEVER creates or
 * changes a company membership: the invitee becomes a member only by accepting the invitation while
 * signed in with the invited email (`public.accept_company_invitation`).
 *
 * The invitee is looked up in Supabase Auth by email (profiles.email is not trusted):
 * - no user: `inviteUserByEmail` creates one and sends the invitation email;
 * - a user who has not confirmed their email yet: the invitation email is sent again (Auth re-invites
 *   unconfirmed users), so they always hold a working link;
 * - a confirmed user: no email; they see the invitation in the app (`GET /me/invitations`).
 * In every case the invitation becomes `sent` (never `accepted`: the status must not reveal whether the
 * email already had an account) with `invited_user_id` and `sent_at` (when an email went out or it was
 * pending).
 *
 * - `pending`: sent as above.
 * - `failed` (re-enqueued by "resend"): reset to `pending` first, then as above.
 * - `sent` (re-enqueued by "resend"): as above; a confirmed user gets no new email; `sent_at` is still stamped so it reveals nothing.
 * - `accepted` / `declined` / `revoked`: nothing is done.
 *
 * Idempotent: the job id is deterministic, every step checks the current state, and the status update
 * is conditional on the status the run started from (a concurrent revoke, decline or accept wins).
 *
 * Permanent failures (Auth 4xx, constraint/guard violations) mark a pending invitation `failed` with the
 * reason; transient ones (network, Auth 5xx/429, database) retry with backoff and mark it failed on the
 * last attempt. A failed resend of a `sent` invitation leaves it `sent` (the earlier email still works).
 */
@Injectable()
export class UserInvitationProcessor implements OnModuleInit {
  private readonly logger = new Logger(UserInvitationProcessor.name)

  constructor(
    private readonly runtime: ProcessorRuntime,
    private readonly clients: ServiceRoleClientFactory,
    @Inject(SupabaseAuthAdmin) private readonly auth: AuthAdmin,
    private readonly clock: Clock,
    @Inject(WORKER_ENV) private readonly env: WorkerEnv,
  ) {}

  onModuleInit(): void {
    this.runtime.start('user-invitations', (payload, attempt) => this.process(payload, attempt), { concurrency: 2 })
  }

  async process({ companyId, invitationId }: JobPayloads['user-invitations'], attempt: JobAttempt): Promise<InvitationOutcome> {
    const db = this.clients.get()
    let invitation = await this.load(db, companyId, invitationId)
    if (!invitation) throw new UnrecoverableError(`Invitation ${invitationId} does not exist in company ${companyId}`)
    if (CLOSED_STATUSES.has(invitation.status)) {
      this.logger.log({ companyId, invitationId, status: invitation.status }, 'Invitation is closed; nothing to send')
      return { outcome: 'skipped', status: invitation.status }
    }
    try {
      if (invitation.status === 'failed') invitation = await this.reopen(db, invitation)
      return await this.send(db, invitation)
    } catch (error) {
      throw await this.failure(db, invitation, error, attempt)
    }
  }

  private async send(db: DbClient, invitation: InvitationRow): Promise<InvitationOutcome> {
    const inviteOptions = { fullName: invitation.full_name, redirectTo: invitationRedirect(this.env.WEB_APP_URL, invitation.id) }
    const existing = await this.authUserFor(invitation)
    let userId: EntityId
    let emailed = false

    if (existing?.emailConfirmed) {
      // A confirmed user accepts in the app; no email.
      userId = existing.id
    } else {
      // A new user, or one who has not used a link yet: (re)send the invitation email.
      const result = await this.auth.inviteUserByEmail(invitation.email, inviteOptions)
      if (result.kind === 'invited') {
        userId = result.user.id
        emailed = true
      } else {
        // The user was created or confirmed meanwhile; a confirmed user gets no email.
        const user = await this.auth.findUserByEmail(invitation.email)
        if (!user) throw new Error(`Supabase Auth reports a user with ${invitation.email}, but none was found`)
        userId = user.id
      }
    }

    const updateResult = await db
      .from('company_invitations')
      .update({
        status: 'sent',
        invited_user_id: userId,
        failure_reason: null,
        // Always stamped, even when no email went out (confirmed user): a sent_at that only moves when an
        // email is sent would tell the admin whether the address has a confirmed account.
        sent_at: this.clock.now().toISOString(),
      })
      .eq('company_id', invitation.company_id)
      .eq('id', invitation.id)
      .eq('status', invitation.status)
      .select('id')
    const updated = unwrap(updateResult, 'Record invitation sent', [])
    if (updated.length === 0) {
      const current = await this.load(db, invitation.company_id, invitation.id)
      if (current && CLOSED_STATUSES.has(current.status)) {
        this.logger.log(
          { companyId: invitation.company_id, invitationId: invitation.id, status: current.status },
          'Invitation was closed while it was being sent; status left as is',
        )
        return { outcome: 'skipped', status: current.status }
      }
      throw new InvitationChangedError(`Invitation ${invitation.id} changed from ${invitation.status} to ${current?.status ?? 'deleted'} while it was being sent`)
    }

    this.logger.log(
      { companyId: invitation.company_id, invitationId: invitation.id, userId, emailed },
      emailed ? 'Invitation email sent' : 'Invitation recorded for a confirmed user; no email sent',
    )
    return { outcome: 'sent', userId, emailed }
  }

  /**
   * The Auth user holding the invitation email, if any. A known `invited_user_id` is checked first (one
   * request instead of paging through the users) and used only while its email still matches.
   */
  private async authUserFor(invitation: InvitationRow): Promise<AuthUserSummary | null> {
    if (invitation.invited_user_id) {
      const known = await this.auth.getUserById(invitation.invited_user_id)
      if (known && known.email?.toLowerCase() === invitation.email.toLowerCase()) return known
    }
    return this.auth.findUserByEmail(invitation.email)
  }

  /** A `failed` invitation that was resent goes back to `pending` before it is sent again. */
  private async reopen(db: DbClient, invitation: InvitationRow): Promise<InvitationRow> {
    const result = await db
      .from('company_invitations')
      .update({ status: 'pending', failure_reason: null })
      .eq('company_id', invitation.company_id)
      .eq('id', invitation.id)
      .eq('status', 'failed')
      .select(INVITATION_COLUMNS)
    if (result.error?.code === '23505') {
      throw new PermanentInvitationError(`Another open invitation for ${invitation.email} already exists in this company`)
    }
    const [reopened] = unwrap(result, 'Reopen failed invitation', [])
    if (!reopened) throw new InvitationChangedError(`Invitation ${invitation.id} is no longer failed; retrying with its current state`)
    return reopened
  }

  private async load(db: DbClient, companyId: EntityId, invitationId: EntityId): Promise<InvitationRow | null> {
    const result = await db.from('company_invitations').select(INVITATION_COLUMNS).eq('company_id', companyId).eq('id', invitationId).maybeSingle()
    return unwrap(result, 'Load invitation', null)
  }

  /**
   * Returns the error to throw: the original one when BullMQ should retry, else an UnrecoverableError
   * after a pending invitation has been marked failed with the reason.
   */
  private async failure(db: DbClient, invitation: InvitationRow, error: unknown, attempt: JobAttempt): Promise<unknown> {
    if (error instanceof UnrecoverableError) return error
    const permanent =
      error instanceof PermanentInvitationError ||
      (error instanceof AuthAdminError && !error.retryable) ||
      (error instanceof WorkerDatabaseError && PERMANENT_DB_CODES.has(error.code))
    if (!permanent && !isFinalAttempt(attempt)) return error
    const message = error instanceof Error ? error.message : String(error)
    const reason = (permanent ? message : `Sending the invitation failed after ${attempt.attempt} attempts: ${message}`).slice(0, 2000)
    await this.markFailed(db, invitation, reason)
    return new UnrecoverableError(reason)
  }

  /** Only a pending (or still failed) invitation is marked failed; a resent `sent` one keeps its status. */
  private async markFailed(db: DbClient, invitation: InvitationRow, reason: string): Promise<void> {
    const result = await db
      .from('company_invitations')
      .update({ status: 'failed', failure_reason: reason })
      .eq('company_id', invitation.company_id)
      .eq('id', invitation.id)
      .in('status', ['pending', 'failed'])
      .select('id')
    const marked = unwrap(result, 'Mark invitation failed', [])
    this.logger.warn(
      { companyId: invitation.company_id, invitationId: invitation.id, reason, markedFailed: marked.length > 0 },
      'Invitation could not be sent',
    )
  }
}
