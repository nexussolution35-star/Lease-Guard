import { UnrecoverableError } from 'bullmq'
import { describe, expect, it } from 'vitest'

import { fakeDb, rpcArgs, type FakeResult, type RecordedQuery } from '../../common/testing/fake-db.test-helpers'
import type { WorkerQueues } from '../queues/worker-queues'
import { clientsFor, COMPANY, unusedRuntime } from '../workers.test-helpers'
import { OwnerSummaryDeliveryProcessor } from './owner-summary-delivery.processor'

const OWNER = '99999999-9999-4999-8999-999999999999'
const SUMMARY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const MESSAGE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const VALUES = ['Pieter Botha', '23 Nov 2026', 'Outstanding R 15 000,00 (first weekly summary)']

interface Setup {
  summary?: unknown[]
  mapping?: unknown
  template?: unknown
  recorded?: unknown[]
}

function harness(setup: Setup = {}) {
  const respond = (query: RecordedQuery): FakeResult => {
    switch (query.table) {
      case 'rpc:reports_owner_summary_message':
        return { data: setup.summary ?? [{ owner_user_id: OWNER, week_start: '2026-11-23', template_values: VALUES, status: 'ready' }], error: null }
      case 'message_type_templates':
        return { data: setup.mapping === undefined ? { message_template_id: 'tpl-1' } : setup.mapping, error: null }
      case 'message_templates':
        return { data: setup.template === undefined ? { body: 'Hi {{1}}, week of {{2}}: {{3}}' } : setup.template, error: null }
      case 'rpc:record_owner_weekly_summary_message':
        return { data: setup.recorded ?? [{ outcome: 'created', communication_id: MESSAGE, reason: null }], error: null }
      default:
        return { data: null, error: { code: 'XX000', message: `unexpected ${query.table}` } }
    }
  }
  const db = fakeDb(respond)
  const enqueued: { queue: string; payloads: unknown[] }[] = []
  const queues = {
    enqueueAll: async (queue: string, payloads: unknown[]) => {
      enqueued.push({ queue, payloads })
      return payloads.map(() => 'job')
    },
  } as unknown as WorkerQueues
  return { processor: new OwnerSummaryDeliveryProcessor(unusedRuntime, clientsFor(db.client), queues), queries: db.queries, enqueued }
}

describe('OwnerSummaryDeliveryProcessor', () => {
  it('records the stored summary as the owner’s message with the chosen template, then queues its delivery', async () => {
    const { processor, queries, enqueued } = harness()
    await expect(processor.run({ companyId: COMPANY, summaryId: SUMMARY })).resolves.toEqual({ outcome: 'queued', communicationId: MESSAGE, recorded: 'created' })

    expect(rpcArgs(queries.find((q) => q.table === 'rpc:reports_owner_summary_message')!)).toEqual({ p_company_id: COMPANY, p_summary_id: SUMMARY })
    expect(rpcArgs(queries.find((q) => q.table === 'rpc:record_owner_weekly_summary_message')!)).toEqual({
      p_company_id: COMPANY,
      p_owner_user_id: OWNER,
      p_week_start: '2026-11-23',
      p_body: `Hi Pieter Botha, week of 23 Nov 2026: ${VALUES[2]}`,
    })
    // Every read is the company's.
    for (const query of queries.filter((q) => !q.table.startsWith('rpc:'))) {
      expect(query.calls).toContainEqual(['eq', ['company_id', COMPANY]])
    }
    expect(enqueued).toEqual([{ queue: 'message-delivery', payloads: [{ companyId: COMPANY, communicationId: MESSAGE }] }])
  })

  it('queues the delivery of a message already recorded for the week again (safe to repeat)', async () => {
    const { processor, enqueued } = harness({ recorded: [{ outcome: 'existing', communication_id: MESSAGE, reason: null }] })
    await expect(processor.run({ companyId: COMPANY, summaryId: SUMMARY })).resolves.toMatchObject({ outcome: 'queued', recorded: 'existing' })
    expect(enqueued).toHaveLength(1)
  })

  it('sends nothing when the database refuses the message (no approved template, no number, not an owner)', async () => {
    const { processor, enqueued } = harness({ recorded: [{ outcome: 'blocked', communication_id: null, reason: 'The company has no connected WhatsApp number' }] })
    await expect(processor.run({ companyId: COMPANY, summaryId: SUMMARY })).resolves.toEqual({ outcome: 'blocked', reason: 'The company has no connected WhatsApp number' })
    expect(enqueued).toEqual([])
  })

  it('sends nothing without a chosen template, or with one that needs values the summary does not have', async () => {
    const unmapped = harness({ mapping: null })
    await expect(unmapped.processor.run({ companyId: COMPANY, summaryId: SUMMARY })).resolves.toMatchObject({ outcome: 'blocked' })
    expect(unmapped.queries.some((q) => q.table === 'rpc:record_owner_weekly_summary_message')).toBe(false)

    const tooMany = harness({ template: { body: '{{1}} {{2}} {{3}} {{4}}' } })
    await expect(tooMany.processor.run({ companyId: COMPANY, summaryId: SUMMARY })).resolves.toMatchObject({ outcome: 'blocked' })
    expect(tooMany.enqueued).toEqual([])
  })

  it('fails without retry when the stored summary does not exist', async () => {
    const { processor } = harness({ summary: [] })
    await expect(processor.run({ companyId: COMPANY, summaryId: SUMMARY })).rejects.toBeInstanceOf(UnrecoverableError)
  })
})
