/**
 * The outbound communication lifecycle: the one module that moves a communication between statuses and
 * knows whether a send may already have happened. Every caller goes through this interface; none of them
 * writes `communications.status`:
 *
 * - the approve / reject endpoints `decide` (as the signed-in user);
 * - the delivery worker `claim`s, `release`s, `recordSent`s and `recordFailed`s (as the service role);
 * - next: the shared WhatsApp webhook `recordProviderStatus`es Meta's sent / delivered / read / failed
 *   callbacks, keyed by the company that owns the receiving number and the provider message id.
 *
 * Interface: one function per transition plus questions about a loaded row (`deliveryState`,
 * `mayHaveBeenSent`, `mayRetryDelivery`), so callers branch on the lifecycle's answer, never on status
 * literals. Each transition is atomic and conditional and answers with an outcome instead of throwing
 * when someone else got there first. Implementation: one SQL function per transition
 * (supabase/migrations/20261110100300_communication_lifecycle.sql), so the rule and the write cannot
 * drift apart, and a transition table the database enforces for every API role, the backend included
 * (for the backend it also accepts delivery-state writes only from inside those functions). The state
 * machine lives there; it is the only copy, so there is no TypeScript table to keep in step.
 *
 * "May have been sent" is a recorded fact (`communications.send_uncertain_since`): set by the claim,
 * immediately before a send, and cleared only when the outcome is known (recorded sent, or the run
 * holding the claim learns WhatsApp certainly refused). A crash between the send and its recording
 * therefore leaves the fact in place; nothing has to be written after the uncertain moment for the
 * message to be protected. A claim is owned: `claim` hands its winner a `SendClaim`, and only that
 * holder can hand the claim back or record that its send did not happen, so a second run of the same
 * job can never erase the fact while the first run's send is in flight.
 *
 * The functions take the caller's client: the API's (RLS, the signed-in user) or the worker's (service
 * role). The database grants each transition to exactly one of the two.
 */

import type { EntityId, ISODateTime } from '@leaseguard/domain'

import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database, Tables } from '../infrastructure/database/database.types'

// The same type as the API's and the worker's DbClient. Spelled out here so the module depends only on
// the schema types, which lets the integration tests drive this interface against local Postgres.
type DbClient = SupabaseClient<Database>
type CommunicationRow = Tables<'communications'>

/** The communication a transition applies to. */
export interface CommunicationRef {
  readonly companyId: EntityId
  readonly communicationId: EntityId
}

/**
 * A lifecycle write failed in the database (unreachable, refused by a guard). Callers translate it at
 * their edge: the API into its HTTP error, the worker by retrying or failing the job. Never carries row
 * data.
 */
export class CommunicationLifecycleError extends Error {
  readonly operation: string
  /** The PostgREST / Postgres error, in the shape `httpErrorFromDatabase` reads. */
  readonly databaseError: { readonly code: string; readonly message: string }

  constructor(operation: string, error: { code: string; message: string }) {
    super(`${operation} failed (${error.code}): ${error.message}`)
    this.name = 'CommunicationLifecycleError'
    this.operation = operation
    this.databaseError = { code: error.code, message: error.message }
  }
}

function outcome<T>(result: { data: unknown; error: { code: string; message: string } | null }, operation: string, allowed: readonly T[]): T {
  if (result.error) throw new CommunicationLifecycleError(operation, result.error)
  if (!allowed.includes(result.data as T)) {
    throw new CommunicationLifecycleError(operation, { code: 'unexpected_outcome', message: `the database answered ${JSON.stringify(result.data)}` })
  }
  return result.data as T
}

// ------------------------------------------------------------------ decide (signed-in user)

export interface ApprovalDecision {
  /** The approval request being decided: the open one, or a decided one whose status move is unfinished. */
  readonly approvalId: EntityId
  readonly decision: 'approved' | 'rejected'
  readonly note?: string
}

/**
 * - `decided`: the request carries the decision and the message moved out of `pending_approval`
 *   (together, in one transaction; the approver is the signed-in caller).
 * - `not_found`: no such message in the company (or not visible to the caller).
 * - `not_pending`: the message is no longer awaiting approval (decided meanwhile, or never was).
 * - `approval_decided`: the request was decided otherwise by someone else.
 */
export type DecideOutcome = 'decided' | 'not_found' | 'not_pending' | 'approval_decided'
const DECIDE_OUTCOMES = ['decided', 'not_found', 'not_pending', 'approval_decided'] as const

export async function decide(db: DbClient, message: CommunicationRef, decision: ApprovalDecision): Promise<DecideOutcome> {
  const result = await db.rpc('decide_communication', {
    p_company_id: message.companyId,
    p_communication_id: message.communicationId,
    p_approval_id: decision.approvalId,
    p_decision: decision.decision,
    ...(decision.note !== undefined ? { p_note: decision.note } : {}),
  })
  return outcome(result, `Record message ${decision.decision}`, DECIDE_OUTCOMES)
}

// ------------------------------------------------------------------ delivery (service role)

/**
 * The right to send one message once, held by the run that won `claim`. Pass it to `release` and to
 * `recordFailed` when the failure is this run's own; nothing else can produce one.
 */
export interface SendClaim extends CommunicationRef {
  /** Opaque: names this claim in the database (it is the moment the claim was made). */
  readonly token: string
}

/**
 * `approved` → `queued`, immediately before a send. Exactly one caller gets the claim; every other one
 * gets null and must not send. From here until the outcome is recorded the message counts as possibly
 * sent.
 */
export async function claim(db: DbClient, message: CommunicationRef): Promise<SendClaim | null> {
  const result = await db.rpc('claim_communication', { p_company_id: message.companyId, p_communication_id: message.communicationId })
  if (result.error) throw new CommunicationLifecycleError('Claim message for sending', result.error)
  // The generated type says string; the function answers null to every caller but the winner.
  const token: unknown = result.data
  if (token === null) return null
  if (typeof token !== 'string' || token === '') {
    throw new CommunicationLifecycleError('Claim message for sending', { code: 'unexpected_outcome', message: `the database answered ${JSON.stringify(token)}` })
  }
  return { companyId: message.companyId, communicationId: message.communicationId, token }
}

/**
 * `queued` → `approved`, only after WhatsApp certainly refused the message, so a retry may send it.
 * False when the claim is no longer this one (the message moved on): nothing changes.
 */
export async function release(db: DbClient, held: SendClaim): Promise<boolean> {
  const result = await db.rpc('release_communication_claim', {
    p_company_id: held.companyId,
    p_communication_id: held.communicationId,
    p_claim: held.token,
  })
  return outcome(result, 'Release send claim', [true, false])
}

/**
 * - `recorded`: the message is `sent` with this provider id, and no longer possibly-sent.
 * - `already_recorded`: it already carries this id (a repeat).
 * - `not_claimed`: no send of it was ever started; nothing is recorded.
 * - `conflict`: it carries another provider id; nothing is recorded.
 * - `not_found`: no such message in the company.
 */
export type RecordSentOutcome = 'recorded' | 'already_recorded' | 'not_claimed' | 'conflict' | 'not_found'
const RECORD_SENT_OUTCOMES = ['recorded', 'already_recorded', 'not_claimed', 'conflict', 'not_found'] as const

/**
 * WhatsApp accepted the message with this id. Applies to any message whose send was uncertain: also one
 * a person stopped, or another run gave up on, while the send was in flight, because it did go out.
 */
export async function recordSent(db: DbClient, message: CommunicationRef, providerMessageId: string): Promise<RecordSentOutcome> {
  const result = await db.rpc('record_communication_sent', {
    p_company_id: message.companyId,
    p_communication_id: message.communicationId,
    p_provider_message_id: providerMessageId,
  })
  return outcome(result, 'Record sent message', RECORD_SENT_OUTCOMES)
}

export interface DeliveryFailure {
  /** Why, for the property manager (stored as the failure reason, at most 2 000 characters). */
  readonly reason: string
  /**
   * Whether WhatsApp may have accepted the message (the send timed out, Meta answered 5xx, an earlier
   * run's outcome is unknown). True keeps it from ever being sent again automatically; false only when
   * nothing was sent or WhatsApp certainly refused.
   */
  readonly mayHaveBeenSent: boolean
}

/**
 * `approved` | `queued` → `failed`. Pass the `SendClaim` when the failure is this run's own send (after
 * its `claim`), else the message's `CommunicationRef`.
 *
 * False, and nothing changes, when the message is in neither state (sent meanwhile, or a person stopped
 * it), or when it is `queued` under a claim the caller does not hold and the failure says nothing was
 * sent: that claim's run may be sending it right now and records its own outcome. A failure that says
 * it may have been sent is always recorded and keeps the fact, so it never makes a message look safe.
 */
export async function recordFailed(db: DbClient, message: CommunicationRef | SendClaim, failure: DeliveryFailure): Promise<boolean> {
  const result = await db.rpc('record_communication_failed', {
    p_company_id: message.companyId,
    p_communication_id: message.communicationId,
    p_reason: failure.reason,
    p_may_have_been_sent: failure.mayHaveBeenSent,
    ...('token' in message ? { p_claim: message.token } : {}),
  })
  return outcome(result, 'Mark message failed', [true, false])
}

// ------------------------------------------------------------------ provider status callbacks (service role)

export type ProviderStatus = 'sent' | 'delivered' | 'read' | 'failed'

export interface ProviderStatusUpdate {
  /** The company that owns the receiving phone number the callback came for. */
  readonly companyId: EntityId
  /** WhatsApp's message id (`wamid…`), as recorded by `recordSent`. */
  readonly providerMessageId: string
  readonly status: ProviderStatus
  /** When WhatsApp says it happened (the callback's timestamp). */
  readonly occurredAt: ISODateTime
  /** WhatsApp's error, for `failed`. */
  readonly failureReason?: string
}

/**
 * - `advanced`: the status moved forward.
 * - `recorded`: only the callback's timestamp was filled (e.g. a "delivered" that arrived after "read").
 * - `unchanged`: a repeat, or a callback the recorded state contradicts (a "failed" after "read").
 * - `not_found`: the company has no message with this id YET. Callbacks are not ordered and can overtake
 *   the worker's `recordSent`; the caller keeps the callback and retries it later, so nothing is lost.
 */
export type ProviderStatusOutcome = 'advanced' | 'recorded' | 'unchanged' | 'not_found'
const PROVIDER_STATUS_OUTCOMES = ['advanced', 'recorded', 'unchanged', 'not_found'] as const

/**
 * Applies one WhatsApp status callback; repeats and any order are safe. Each callback fills its own
 * timestamp only when empty, the status only moves forward along sent → delivered → read, and "failed"
 * applies only before any delivery evidence (a failed message stays failed).
 */
export async function recordProviderStatus(db: DbClient, update: ProviderStatusUpdate): Promise<ProviderStatusOutcome> {
  const result = await db.rpc('record_communication_provider_status', {
    p_company_id: update.companyId,
    p_provider_message_id: update.providerMessageId,
    p_status: update.status,
    p_occurred_at: update.occurredAt,
    ...(update.failureReason !== undefined ? { p_failure_reason: update.failureReason } : {}),
  })
  return outcome(result, 'Record WhatsApp status', PROVIDER_STATUS_OUTCOMES)
}

// ------------------------------------------------------------------ questions about a loaded message

type LifecycleFields = Pick<CommunicationRow, 'status' | 'external_message_id' | 'send_uncertain_since'>

/**
 * Where a loaded message stands for delivery, from the recorded facts:
 * - `already_sent`: a provider id is recorded or the status is sent or later: WhatsApp accepted it
 *   (an inbound message carries WhatsApp's id too). Never send it again.
 * - `possibly_sent`: a send may have reached WhatsApp without LeaseGuard holding its id (claimed and
 *   unresolved, or failed / stopped with the fact set). Never send it again automatically; a person
 *   checks the WhatsApp conversation.
 * - `sendable`: approved, no claim, certainly not sent: a run may claim it.
 * - `not_sendable`: certainly not sent and not approved for sending (draft, pending approval, rejected,
 *   failed).
 */
export type DeliveryState = 'already_sent' | 'possibly_sent' | 'sendable' | 'not_sendable'

const SENT_STATUSES: ReadonlySet<CommunicationRow['status']> = new Set(['sent', 'delivered', 'read'])

export function deliveryState(communication: LifecycleFields): DeliveryState {
  if (communication.external_message_id !== null || SENT_STATUSES.has(communication.status)) return 'already_sent'
  if (mayHaveBeenSent(communication)) return 'possibly_sent'
  return communication.status === 'approved' ? 'sendable' : 'not_sendable'
}

/** Whether WhatsApp may have accepted this message without LeaseGuard holding its message id. */
export function mayHaveBeenSent(communication: Pick<CommunicationRow, 'send_uncertain_since'>): boolean {
  return communication.send_uncertain_since !== null
}

/**
 * Whether a failed delivery job for this message may run again without risking a second send: only
 * while it is `sendable` (approved, no claim held, nothing possibly sent; a claim is only handed back
 * when WhatsApp certainly sent nothing). A job that stalled or died before its claim qualifies; one that
 * died after it does not (the message is `queued`, possibly sent). A retry that races a still-running
 * stale run is safe too: only one of them can win the claim, and the loser cannot clear the winner's
 * possibly-sent fact.
 */
export function mayRetryDelivery(communication: LifecycleFields): boolean {
  return deliveryState(communication) === 'sendable'
}
