import { BadRequestException, ForbiddenException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'

import { fakeDb, rpcArgs } from '../../common/testing/fake-db.test-helpers'
import { CommunicationAnalyticsService } from './communication-analytics.service'

const COMPANY = '6f1d2c1e-0000-4000-8000-000000000001'
const row = {
  inbound_messages: 12,
  outbound_messages: 9,
  delivered_messages: 8,
  read_messages: 5,
  failed_messages: 1,
  handovers_opened: 3,
  handovers_by_agent: 2,
  agent_replies: 4,
  out_of_hours_messages: 1,
  suggested_replies: 2,
}
// 10 Nov 2026 23:30 UTC is already 11 Nov in South Africa.
const NOW = new Date('2026-11-10T23:30:00Z')

describe('CommunicationAnalyticsService.figures', () => {
  it("asks the database for the company's figures over the range and names them", async () => {
    const db = fakeDb(() => ({ data: [row], error: null }))
    const figures = await new CommunicationAnalyticsService().figures(db.client, COMPANY, { from: '2026-10-01', to: '2026-10-31' }, NOW)

    expect(db.queries.map((q) => q.table)).toEqual(['rpc:communication_analytics'])
    expect(rpcArgs(db.queries[0]!)).toEqual({ p_company_id: COMPANY, p_from: '2026-10-01', p_to: '2026-10-31' })
    expect(figures).toEqual({
      from: '2026-10-01',
      to: '2026-10-31',
      inbound: 12,
      outbound: 9,
      delivered: 8,
      read: 5,
      failed: 1,
      handovers: 3,
      agentHandovers: 2,
      agentReplies: 4,
      outOfHoursMessages: 1,
      suggestedReplies: 2,
    })
  })

  it('defaults to the last 30 South African days', async () => {
    const db = fakeDb(() => ({ data: [row], error: null }))
    const figures = await new CommunicationAnalyticsService().figures(db.client, COMPANY, {}, NOW)
    expect(rpcArgs(db.queries[0]!)).toMatchObject({ p_from: '2026-10-13', p_to: '2026-11-11' })
    expect(figures).toMatchObject({ from: '2026-10-13', to: '2026-11-11' })
  })

  it('a start alone runs to today; an end alone covers the 30 days up to it', async () => {
    const db = fakeDb(() => ({ data: [row], error: null }))
    const service = new CommunicationAnalyticsService()
    await service.figures(db.client, COMPANY, { from: '2026-11-01' }, NOW)
    await service.figures(db.client, COMPANY, { to: '2026-06-30' }, NOW)
    expect(rpcArgs(db.queries[0]!)).toMatchObject({ p_from: '2026-11-01', p_to: '2026-11-11' })
    expect(rpcArgs(db.queries[1]!)).toMatchObject({ p_from: '2026-06-01', p_to: '2026-06-30' })
  })

  it('refuses a reversed or over-long range without asking the database', async () => {
    const db = fakeDb(() => ({ data: [row], error: null }))
    const service = new CommunicationAnalyticsService()
    await expect(service.figures(db.client, COMPANY, { from: '2026-11-02', to: '2026-11-01' }, NOW)).rejects.toThrow(
      new BadRequestException('The end date must be on or after the start date.'),
    )
    await expect(service.figures(db.client, COMPANY, { from: '2024-01-01', to: '2025-01-01' }, NOW)).rejects.toThrow(
      new BadRequestException('Choose a range of at most 366 days.'),
    )
    await expect(service.figures(db.client, COMPANY, { from: '2026-12-01' }, NOW)).rejects.toBeInstanceOf(BadRequestException)
    expect(db.queries).toEqual([])
  })

  it("maps the database's refusals", async () => {
    const forbidden = fakeDb(() => ({ data: null, error: { code: '42501', message: 'Only members' } }))
    await expect(new CommunicationAnalyticsService().figures(forbidden.client, COMPANY, {}, NOW)).rejects.toBeInstanceOf(ForbiddenException)
    const badRange = fakeDb(() => ({ data: null, error: { code: '22023', message: 'A range is at most 366 days' } }))
    await expect(new CommunicationAnalyticsService().figures(badRange.client, COMPANY, {}, NOW)).rejects.toThrow(
      new BadRequestException('A range is at most 366 days'),
    )
  })
})
