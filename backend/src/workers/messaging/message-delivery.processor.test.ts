import { UnrecoverableError } from 'bullmq'
import { describe, expect, it, vi } from 'vitest'

import { callsTo, fakeDb, type FakeResult, type RecordedQuery, rpcArgs } from '../../common/testing/fake-db.test-helpers'
import { FakeWhatsAppChannels, type FakeChannelOptions } from '../../infrastructure/whatsapp/fake-whatsapp-channels.test-helpers'
import { ChannelLookupError, WhatsAppApiError, type WhatsAppMessage } from '../../infrastructure/whatsapp/whatsapp-channels'
import type { StatementFiles } from '../shared/statement-files'
import { clientsFor, COMPANY, eqValue, fixedClock, isWrite, MANAGER, PROPERTY, router, TENANT, unusedRuntime } from '../workers.test-helpers'
import { MessageDeliveryProcessor } from './message-delivery.processor'

const COMMUNICATION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const NUMBER = '+27821234567'
const REQUESTER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const approvedApproval = {
  id: 'apr-1',
  decision: 'approved',
  requested_at: '2026-11-08T10:00:00+02:00',
  requested_by_user_id: REQUESTER,
  decided_by_user_id: MANAGER,
}

const communicationRow: Record<string, unknown> = {
  id: COMMUNICATION,
  company_id: COMPANY,
  channel: 'whatsapp',
  direction: 'outbound',
  message_type: 'overdue_payment_reminder',
  recipient_type: 'tenant',
  tenant_id: TENANT,
  owner_user_id: null,
  property_id: PROPERTY,
  lease_id: null,
  statement_id: null,
  arrangement_id: null,
  template_id: null,
  counterparty_number: NUMBER,
  company_number: '+27115550100',
  body: 'Dear Test Trading, your October statement shows R 12 500,00 outstanding. Please contact your property manager.',
  attachment_file_name: null,
  attachment_storage_path: null,
  attachment_mime_type: null,
  attachment_size_bytes: null,
  attachment_sha256: null,
  status: 'approved',
  external_message_id: null,
  created_by_user_id: MANAGER,
  sent_at: null,
  delivered_at: null,
  read_at: null,
  failure_reason: null,
  send_uncertain_since: null,
}

const tenantRow: Record<string, unknown> = { id: TENANT, whatsapp_number: NUMBER, whatsapp_verified: true, whatsapp_opted_out: false, status: 'active' }

interface Options {
  communication?: Record<string, unknown>
  tenant?: Record<string, unknown>
  approvals?: unknown[]
  arrangements?: unknown[]
  /** The company's whatsapp_phone_numbers row as the outbound gate reads it; defaults to connected. */
  account?: Record<string, unknown>
  /** The company's channel, when it is not the default available one. */
  channel?: Pick<FakeChannelOptions, 'unavailable' | 'lookupError'>
  send?: () => Promise<{ messageId: string }>
  upload?: () => Promise<{ mediaId: string }>
  respond?: (query: RecordedQuery) => FakeResult | undefined
}

/** The lifecycle operation a recorded query calls, by its database function. */
const LIFECYCLE_OPERATIONS: Readonly<Record<string, string>> = {
  'rpc:claim_communication': 'claim',
  'rpc:release_communication_claim': 'release',
  'rpc:record_communication_sent': 'recordSent',
  'rpc:record_communication_failed': 'recordFailed',
}
const isLifecycle = (operation: string) => (query: RecordedQuery) => LIFECYCLE_OPERATIONS[query.table] === operation
const isClaim = isLifecycle('claim')

/** The token the database hands the run that wins the claim. */
const CLAIM = '2026-11-09T08:00:00.123456+00:00'

/** What each lifecycle operation answers unless a test says otherwise: every transition succeeds. */
function lifecycleSucceeds(query: RecordedQuery): FakeResult | undefined {
  switch (LIFECYCLE_OPERATIONS[query.table]) {
    case 'claim':
      return { data: CLAIM, error: null }
    case 'release':
    case 'recordFailed':
      return { data: true, error: null }
    case 'recordSent':
      return { data: 'recorded', error: null }
    default:
      return undefined
  }
}

function harness(options: Options = {}) {
  const db = fakeDb(
    router({
      respond: (query) => options.respond?.(query) ?? lifecycleSucceeds(query),
      reads: {
        communications: [{ ...communicationRow, ...options.communication }],
        message_approvals: options.approvals ?? [approvedApproval],
        tenants: [{ ...tenantRow, ...options.tenant }],
        payment_arrangements: options.arrangements ?? [],
        properties: [{ manager_user_id: MANAGER }],
        whatsapp_phone_numbers: [options.account ?? { connection_status: 'connected' }],
      },
    }),
  )
  const send = options.send ?? (async () => ({ messageId: 'wamid.SENT' }))
  const sendMessage = vi.fn((_to: string, _message: WhatsAppMessage) => send())
  const channels = new FakeWhatsAppChannels({ ...options.channel, send: (to, message) => sendMessage(to, message), upload: options.upload })
  const processor = new MessageDeliveryProcessor(
    unusedRuntime,
    clientsFor(db.client),
    channels,
    { download: vi.fn(async () => new Blob(['%PDF'])) } as unknown as StatementFiles,
    fixedClock('2026-11-09T08:00:00Z'),
  )
  return { processor, queries: db.queries, sendMessage, channels }
}

const payload = { companyId: COMPANY, communicationId: COMMUNICATION }
const firstAttempt = { attempt: 1, maxAttempts: 5 }
/**
 * The lifecycle transitions a run asked for, in order, with what each one says about the message and
 * whether it presented the run's own claim (`held`).
 */
const transitions = (queries: RecordedQuery[]) =>
  queries.flatMap((query) => {
    const operation = LIFECYCLE_OPERATIONS[query.table]
    if (!operation) return []
    const args = rpcArgs(query)
    return [
      {
        operation,
        ...(args.p_provider_message_id !== undefined ? { providerMessageId: args.p_provider_message_id } : {}),
        ...(args.p_reason !== undefined ? { reason: args.p_reason, mayHaveBeenSent: args.p_may_have_been_sent } : {}),
        ...(args.p_claim !== undefined ? { held: args.p_claim === CLAIM } : {}),
      },
    ]
  })
/** A failure recorded without a claim: before this run's claim, or for a claim another run made. */
const failed = (reason: unknown, mayHaveBeenSent = false) => ({ operation: 'recordFailed', reason, mayHaveBeenSent })
/** A failure of this run's own send, presenting its claim. */
const failedHolding = (reason: unknown, mayHaveBeenSent = false) => ({ ...failed(reason, mayHaveBeenSent), held: true })
const released = { operation: 'release', held: true }
const notificationRows = (queries: RecordedQuery[]) =>
  queries.filter((q) => q.table === 'notifications').flatMap((q) => callsTo(q, 'upsert').map(([rows]) => rows))

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('expected the promise to reject')
}

describe('MessageDeliveryProcessor', () => {
  it('sends an approved, eligible message: claims it, sends it and records the WhatsApp id', async () => {
    const { processor, queries, sendMessage, channels } = harness()
    await expect(processor.deliver(payload, firstAttempt)).resolves.toEqual({ outcome: 'sent', externalMessageId: 'wamid.SENT' })
    // Sent through the job's company's channel.
    expect(channels.lookups).toEqual([{ companyId: COMPANY, options: {} }])
    expect(sendMessage).toHaveBeenCalledWith(NUMBER, {
      type: 'text',
      text: { body: communicationRow.body, preview_url: false },
    })
    expect(transitions(queries)).toEqual([{ operation: 'claim' }, { operation: 'recordSent', providerMessageId: 'wamid.SENT' }])
    // The run never writes the message itself; every transition is the lifecycle's, for this company's message.
    expect(queries.filter((q) => q.table === 'communications' && isWrite(q))).toEqual([])
    for (const query of queries.filter((q) => q.table.startsWith('rpc:'))) {
      expect(rpcArgs(query)).toMatchObject({ p_company_id: COMPANY, p_communication_id: COMMUNICATION })
    }
    for (const query of queries.filter((q) => q.table !== 'profiles' && !q.table.startsWith('rpc:'))) expect(eqValue(query, 'company_id')).toBe(COMPANY)
  })

  it('is idempotent: a message that already has a WhatsApp id is never sent again', async () => {
    const { processor, sendMessage, queries } = harness({ communication: { external_message_id: 'wamid.OLD', status: 'approved' } })
    await expect(processor.deliver(payload, firstAttempt)).resolves.toEqual({ outcome: 'already_sent', externalMessageId: 'wamid.OLD' })
    expect(sendMessage).not.toHaveBeenCalled()
    expect(transitions(queries)).toEqual([])
    expect(queries.filter(isWrite)).toEqual([])
  })

  it('refuses a message that is not approved, without touching it', async () => {
    const { processor, sendMessage, queries } = harness({ communication: { status: 'pending_approval' } })
    await expect(processor.deliver(payload, firstAttempt)).rejects.toBeInstanceOf(UnrecoverableError)
    expect(sendMessage).not.toHaveBeenCalled()
    expect(transitions(queries)).toEqual([])
    expect(queries.filter(isWrite)).toEqual([])
  })

  it('records the failure and notifies the manager when the approval is not approved', async () => {
    const { processor, sendMessage, queries } = harness({ approvals: [{ id: 'apr-1', decision: 'pending', requested_at: '2026-11-08T10:00:00+02:00' }] })
    await expect(processor.deliver(payload, firstAttempt)).rejects.toBeInstanceOf(UnrecoverableError)
    expect(sendMessage).not.toHaveBeenCalled()
    expect(transitions(queries)).toEqual([failed('Message must not be delivered: Property manager approval is required before sending')])
    expect(notificationRows(queries)).toEqual([
      [expect.objectContaining({ type: 'message_failed', user_id: MANAGER, dedupe_key: `message_failed:${COMMUNICATION}:${MANAGER}`, link_entity_id: COMMUNICATION })],
    ])
  })

  it('never sends an approval that does not record who approved it', async () => {
    const { processor, sendMessage, queries } = harness({ approvals: [{ ...approvedApproval, decided_by_user_id: null }] })
    await expect(processor.deliver(payload, firstAttempt)).rejects.toBeInstanceOf(UnrecoverableError)
    expect(sendMessage).not.toHaveBeenCalled()
    expect(transitions(queries)).toEqual([failed('Message must not be delivered: The message approval does not record who approved it')])
    expect(notificationRows(queries)).toEqual([[expect.objectContaining({ type: 'message_failed', user_id: MANAGER })]])
  })

  it('sends a message the requester approved themselves', async () => {
    const { processor, sendMessage } = harness({ approvals: [{ ...approvedApproval, decided_by_user_id: REQUESTER }] })
    await expect(processor.deliver(payload, firstAttempt)).resolves.toEqual({ outcome: 'sent', externalMessageId: 'wamid.SENT' })
    expect(sendMessage).toHaveBeenCalledTimes(1)
  })

  it('applies the domain delivery gate: opted-out tenants and suppressed arrears reminders are never messaged', async () => {
    const optedOut = harness({ tenant: { whatsapp_opted_out: true } })
    await expect(optedOut.processor.deliver(payload, firstAttempt)).rejects.toBeInstanceOf(UnrecoverableError)
    expect(optedOut.sendMessage).not.toHaveBeenCalled()
    expect(transitions(optedOut.queries)).toEqual([failed(expect.stringMatching(/opted out/))])

    const suppressed = harness({
      arrangements: [{ tenant_id: TENANT, status: 'active', agreed_on: '2026-10-01', closed_on: null, suppress_arrears_reminders: true }],
    })
    await expect(suppressed.processor.deliver(payload, firstAttempt)).rejects.toBeInstanceOf(UnrecoverableError)
    expect(suppressed.sendMessage).not.toHaveBeenCalled()
    expect(transitions(suppressed.queries)).toEqual([failed(expect.stringMatching(/paused by an active payment arrangement/))])
  })

  it('fails permanently when the recipient number changed after approval', async () => {
    const { processor, sendMessage, queries } = harness({ tenant: { whatsapp_number: '+27839999999' } })
    await expect(processor.deliver(payload, firstAttempt)).rejects.toBeInstanceOf(UnrecoverableError)
    expect(sendMessage).not.toHaveBeenCalled()
    expect(transitions(queries)).toEqual([failed(expect.stringMatching(/no longer the number this message is addressed to/))])
  })

  it('applies the outbound gate before opening the channel: a disconnected account is never asked for a token', async () => {
    const { processor, sendMessage, queries, channels } = harness({ account: { connection_status: 'disconnected' } })
    await expect(processor.deliver(payload, firstAttempt)).rejects.toBeInstanceOf(UnrecoverableError)
    expect(channels.lookups).toEqual([])
    expect(sendMessage).not.toHaveBeenCalled()
    expect(transitions(queries)).toEqual([failed('Message must not be delivered: The company WhatsApp account is disconnected')])
  })

  it('fails a message whose template Meta has not approved, without claiming it', async () => {
    const { processor, sendMessage, queries } = harness({
      communication: { template_id: 'tpl-1' },
      respond: (query) =>
        query.table === 'message_templates'
          ? {
              data: {
                meta_template_name: 'overdue_reminder',
                language: 'en_ZA',
                body: communicationRow.body,
                approval_status: 'submitted',
                supports_document_attachment: false,
                message_type: 'overdue_payment_reminder',
              },
              error: null,
            }
          : undefined,
    })
    await expect(processor.deliver(payload, firstAttempt)).rejects.toBeInstanceOf(UnrecoverableError)
    expect(sendMessage).not.toHaveBeenCalled()
    expect(transitions(queries)).toEqual([failed('Message must not be delivered: WhatsApp template "overdue_reminder" is not approved by Meta')])
  })

  // A channel the gate found connected can still fail to open (its credential cannot be resolved).
  it.each([
    ['not_configured', 'The company has no WhatsApp Business account configured'],
    ['not_connected', 'The company WhatsApp account is pending verification'],
    ['credentials_unavailable', 'The WhatsApp access token reference is not supported'],
  ] as const)('fails permanently when the company has no channel (%s), with the channel\'s reason', async (reason, message) => {
    const { processor, sendMessage, queries } = harness({ channel: { unavailable: { reason, message } } })
    await expect(processor.deliver(payload, firstAttempt)).rejects.toBeInstanceOf(UnrecoverableError)
    expect(sendMessage).not.toHaveBeenCalled()
    expect(transitions(queries)).toEqual([failed(message)])
    expect(notificationRows(queries)).toEqual([[expect.objectContaining({ type: 'message_failed', user_id: MANAGER })]])
  })

  it('retries a transient channel lookup failure without claiming the message, and fails it on the last attempt', async () => {
    const lookupError = new ChannelLookupError('Load WhatsApp account', 'PGRST000', 'connection refused')
    const transient = harness({ channel: { lookupError } })
    await expect(transient.processor.deliver(payload, firstAttempt)).rejects.toBe(lookupError)
    expect(transient.sendMessage).not.toHaveBeenCalled()
    expect(transitions(transient.queries)).toEqual([])

    const exhausted = harness({ channel: { lookupError } })
    await expect(exhausted.processor.deliver(payload, { attempt: 5, maxAttempts: 5 })).rejects.toBeInstanceOf(UnrecoverableError)
    expect(transitions(exhausted.queries)).toEqual([failed(expect.stringMatching(/^Delivery failed after 5 attempts: Load WhatsApp account failed/))])
  })

  it('uploads the attachment through the same channel before sending it as a document', async () => {
    const { processor, sendMessage, channels } = harness({
      communication: {
        message_type: 'monthly_statement',
        attachment_storage_path: `${COMPANY}/${COMMUNICATION}/oct.pdf`,
        attachment_file_name: 'oct.pdf',
        attachment_mime_type: 'application/pdf',
        body: 'Dear Test Trading, your October statement is attached.',
      },
    })
    await expect(processor.deliver(payload, firstAttempt)).resolves.toEqual({ outcome: 'sent', externalMessageId: 'wamid.SENT' })
    expect(channels.uploads).toEqual([{ companyId: COMPANY, fileName: 'oct.pdf', mimeType: 'application/pdf' }])
    expect(sendMessage).toHaveBeenCalledWith(NUMBER, expect.objectContaining({ type: 'document', document: expect.objectContaining({ id: 'media-1' }) }))
  })

  it('retries a send WhatsApp refused for rate limiting, handing the claim back first, and fails other 4xx without retry', async () => {
    for (const refusal of [
      new WhatsAppApiError('WhatsApp Graph API returned HTTP 429: slow down', { retryable: true, status: 429 }),
      new WhatsAppApiError('WhatsApp Graph API returned HTTP 408: timeout', { retryable: true, status: 408 }),
      new WhatsAppApiError('WhatsApp Graph API returned HTTP 400 (code 130429): Rate limit hit', { retryable: true, status: 400, graphCode: 130429 }),
    ]) {
      const limited = harness({
        send: async () => {
          throw refusal
        },
      })
      const retryable = await rejection(limited.processor.deliver(payload, firstAttempt))
      expect(retryable).toBe(refusal)
      expect(retryable).not.toBeInstanceOf(UnrecoverableError)
      expect(transitions(limited.queries)).toEqual([{ operation: 'claim' }, released])
    }

    const exhausted = harness({
      send: async () => {
        throw new WhatsAppApiError('WhatsApp Graph API returned HTTP 429: slow down', { retryable: true, status: 429 })
      },
    })
    await expect(exhausted.processor.deliver(payload, { attempt: 5, maxAttempts: 5 })).rejects.toBeInstanceOf(UnrecoverableError)
    // WhatsApp refused every time, so the failure is recorded as certainly not sent.
    expect(transitions(exhausted.queries)).toEqual([{ operation: 'claim' }, failedHolding(expect.stringMatching(/^Delivery failed after 5 attempts/))])

    const invalid = harness({
      send: async () => {
        throw new WhatsAppApiError('WhatsApp Graph API returned HTTP 400 (code 131026): Message undeliverable', { retryable: false, status: 400 })
      },
    })
    await expect(invalid.processor.deliver(payload, firstAttempt)).rejects.toBeInstanceOf(UnrecoverableError)
    expect(transitions(invalid.queries)).toEqual([
      { operation: 'claim' },
      failedHolding('WhatsApp Graph API returned HTTP 400 (code 131026): Message undeliverable'),
    ])
  })

  it('keeps the claim when handing it back fails: the retry then treats the message as possibly sent', async () => {
    const { processor } = harness({
      send: async () => {
        throw new WhatsAppApiError('WhatsApp Graph API returned HTTP 429: slow down', { retryable: true, status: 429 })
      },
      respond: (query) => (isLifecycle('release')(query) ? { data: null, error: { code: 'PGRST000', message: 'connection lost' } } : undefined),
    })
    // The refusal is still retried; the claim stays, so the retry will not send (see the queued case below).
    await expect(processor.deliver(payload, firstAttempt)).rejects.toBeInstanceOf(WhatsAppApiError)
  })

  it.each([
    ['a timeout', new WhatsAppApiError('WhatsApp Graph API unreachable (TimeoutError: aborted)', { retryable: true, outcomeUnknown: true })],
    ['a network error', new WhatsAppApiError('WhatsApp Graph API unreachable (TypeError: fetch failed)', { retryable: true, outcomeUnknown: true })],
    ['a server error', new WhatsAppApiError('WhatsApp Graph API returned HTTP 503: down', { retryable: true, status: 503, outcomeUnknown: true })],
    ['a success without a message id', new WhatsAppApiError('Unexpected WhatsApp send response: no message id', { retryable: false, outcomeUnknown: true })],
    ['an unexpected error', new Error('socket hang up')],
  ])('never retries a send whose outcome is unknown (%s): the failure is recorded as possibly sent', async (_case, failure) => {
    const { processor, queries, sendMessage } = harness({
      send: async () => {
        throw failure
      },
    })
    const error = await rejection(processor.deliver(payload, firstAttempt))
    expect(error).toBeInstanceOf(UnrecoverableError)
    expect(sendMessage).toHaveBeenCalledTimes(1)
    // The recorded fact, not the wording, is what keeps the approve endpoint from running the job again.
    expect(transitions(queries)).toEqual([{ operation: 'claim' }, failedHolding(expect.stringMatching(/check the WhatsApp conversation/), true)])
    expect(notificationRows(queries)).toEqual([[expect.objectContaining({ type: 'message_failed', user_id: MANAGER })]])
  })

  it('still retries failures before the send, even ones with an unknown outcome, without claiming the message', async () => {
    const { processor, queries, sendMessage } = harness({
      communication: {
        message_type: 'monthly_statement',
        attachment_storage_path: `${COMPANY}/${COMMUNICATION}/oct.pdf`,
        attachment_file_name: 'oct.pdf',
        attachment_mime_type: 'application/pdf',
        body: 'Dear Test Trading, your October statement is attached.',
      },
      upload: async () => {
        throw new WhatsAppApiError('WhatsApp Graph API unreachable (TimeoutError: aborted)', { retryable: true, outcomeUnknown: true })
      },
    })
    const error = await rejection(processor.deliver(payload, firstAttempt))
    expect(error).toBeInstanceOf(WhatsAppApiError)
    expect(error).not.toBeInstanceOf(UnrecoverableError)
    expect(sendMessage).not.toHaveBeenCalled()
    expect(transitions(queries)).toEqual([])
  })

  it('retries when the claim itself cannot be written: nothing was sent', async () => {
    const { processor, sendMessage } = harness({
      respond: (query) => (isClaim(query) ? { data: null, error: { code: 'PGRST000', message: 'connection refused' } } : undefined),
    })
    const error = await rejection(processor.deliver(payload, firstAttempt))
    expect(error).not.toBeInstanceOf(UnrecoverableError)
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('never sends a message an earlier run claimed (queued): a stalled or crashed run may have sent it', async () => {
    const { processor, queries, sendMessage } = harness({ communication: { status: 'queued', send_uncertain_since: '2026-11-09T07:59:00Z' } })
    const error = await rejection(processor.deliver(payload, firstAttempt))
    expect(error).toBeInstanceOf(UnrecoverableError)
    expect(sendMessage).not.toHaveBeenCalled()
    // Not this run's claim: it keeps the fact and presents no claim.
    expect(transitions(queries)).toEqual([failed(expect.stringMatching(/did not record the result/), true)])
    expect(notificationRows(queries)).toEqual([[expect.objectContaining({ type: 'message_failed', user_id: MANAGER })]])
  })

  it.each(['failed', 'rejected'])('never sends a %s message that may have been sent, and leaves it as it is', async (status) => {
    const { processor, queries, sendMessage } = harness({
      communication: { status, send_uncertain_since: '2026-11-09T07:59:00Z' },
      respond: (query) => (isLifecycle('recordFailed')(query) ? { data: false, error: null } : undefined),
    })
    await expect(processor.deliver(payload, firstAttempt)).rejects.toBeInstanceOf(UnrecoverableError)
    expect(sendMessage).not.toHaveBeenCalled()
    expect(transitions(queries)).toEqual([failed(expect.stringMatching(/did not record the result/), true)])
    expect(notificationRows(queries)).toEqual([])
  })

  it('fails before its own claim without presenting one, so it cannot clear the claim of a run whose send is in flight', async () => {
    // This run loaded the message as approved; meanwhile another run of the job claimed it and is
    // sending. This run's last attempt fails before the send: the lifecycle leaves the other run's claim
    // (and its "may have been sent") alone and answers false, so nobody is told it was not sent.
    const { processor, queries, sendMessage } = harness({
      channel: { lookupError: new ChannelLookupError('Load WhatsApp account', 'PGRST000', 'connection refused') },
      respond: (query) => (isLifecycle('recordFailed')(query) ? { data: false, error: null } : undefined),
    })
    await expect(processor.deliver(payload, { attempt: 5, maxAttempts: 5 })).rejects.toBeInstanceOf(UnrecoverableError)
    expect(sendMessage).not.toHaveBeenCalled()
    expect(transitions(queries)).toEqual([failed(expect.stringMatching(/^Delivery failed after 5 attempts/))])
    expect(notificationRows(queries)).toEqual([])
  })

  it('does not send when another run claimed the message first, and leaves the record to that run', async () => {
    const { processor, queries, sendMessage } = harness({
      respond: (query) => (isClaim(query) ? { data: null, error: null } : undefined),
    })
    const error = await rejection(processor.deliver(payload, firstAttempt))
    expect(error).toBeInstanceOf(UnrecoverableError)
    expect(sendMessage).not.toHaveBeenCalled()
    expect(transitions(queries)).toEqual([{ operation: 'claim' }])
  })

  it('notifies nobody when the message moved on before its failure was recorded (a person stopped it)', async () => {
    const { processor, queries } = harness({
      account: { connection_status: 'disconnected' },
      respond: (query) => (isLifecycle('recordFailed')(query) ? { data: false, error: null } : undefined),
    })
    await expect(processor.deliver(payload, firstAttempt)).rejects.toBeInstanceOf(UnrecoverableError)
    expect(notificationRows(queries)).toEqual([])
  })

  it('runs a stalled job again safely: a second run of the same delivery never sends twice', async () => {
    // The message as the lifecycle keeps it: the first run claims and sends, then "dies" before recording.
    let status = 'approved'
    let sendUncertainSince: string | null = null
    const { processor, sendMessage } = harness({
      respond: (query) => {
        if (query.table === 'communications') return { data: { ...communicationRow, status, send_uncertain_since: sendUncertainSince }, error: null }
        switch (LIFECYCLE_OPERATIONS[query.table]) {
          case 'claim':
            if (status !== 'approved') return { data: null, error: null }
            ;[status, sendUncertainSince] = ['queued', CLAIM]
            return { data: CLAIM, error: null }
          case 'recordSent':
            return { data: null, error: { code: 'PGRST000', message: 'process killed' } }
          case 'recordFailed':
            status = 'failed'
            return { data: true, error: null }
          default:
            return undefined
        }
      },
    })
    await rejection(processor.deliver(payload, firstAttempt))
    const rerun = await rejection(processor.deliver(payload, firstAttempt))
    expect(rerun).toBeInstanceOf(UnrecoverableError)
    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(status).toBe('failed')
    expect(sendUncertainSince).not.toBeNull()
  })

  it('never retries after a successful send, even when the result cannot be saved', async () => {
    const { processor, sendMessage, queries } = harness({
      respond: (query) => (isLifecycle('recordSent')(query) ? { data: null, error: { code: 'PGRST000', message: 'connection lost' } } : undefined),
    })
    const error = await rejection(processor.deliver(payload, firstAttempt))
    expect(error).toBeInstanceOf(UnrecoverableError)
    expect((error as Error).message).toMatch(/^Message sent as wamid\.SENT but its status could not be saved/)
    expect(sendMessage).toHaveBeenCalledTimes(1)
    // Retried in-process only; the claim already recorded that the message may have been sent.
    expect(transitions(queries).map((t) => t.operation)).toEqual(['claim', 'recordSent', 'recordSent', 'recordSent'])
  })

  it('does not retry recording a send the lifecycle refuses: retrying cannot fix it', async () => {
    const { processor, queries } = harness({
      respond: (query) => (isLifecycle('recordSent')(query) ? { data: 'conflict', error: null } : undefined),
    })
    await expect(processor.deliver(payload, firstAttempt)).rejects.toThrow(/^Message sent as wamid\.SENT .*answered conflict/)
    expect(transitions(queries).map((t) => t.operation)).toEqual(['claim', 'recordSent'])
  })
})
