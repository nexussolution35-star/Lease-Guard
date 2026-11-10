import { NotFoundException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'

import { callsTo, dataApiPage, fakeDb } from '../../common/testing/fake-db.test-helpers'
import type { ArrangementInstallmentRow, PaymentArrangementRow } from './arrangements.mapper'
import { arrangementListQuerySchema } from './arrangements.schemas'
import { ArrangementsService } from './arrangements.service'

const COMPANY = '3ab0fc4a-eadb-50b8-bc4d-5673ada1519e'
const ARRANGEMENT = '6f1d2c1e-0000-4000-8000-0000000000aa'
const OTHER = '6f1d2c1e-0000-4000-8000-0000000000ab'
const TENANT = '6f1d2c1e-0000-4000-8000-0000000000dd'

function arrangementRow(overrides: Partial<PaymentArrangementRow> = {}): PaymentArrangementRow {
  return {
    id: ARRANGEMENT,
    company_id: COMPANY,
    tenant_id: TENANT,
    property_id: '6f1d2c1e-0000-4000-8000-0000000000cc',
    unit_id: '6f1d2c1e-0000-4000-8000-0000000000ce',
    lease_id: '6f1d2c1e-0000-4000-8000-0000000000cf',
    outstanding_balance: 75_600,
    installment_amount: 12_600,
    frequency: 'monthly',
    first_installment_date: '2026-11-01',
    final_installment_date: '2027-04-01',
    status: 'active',
    suppress_arrears_reminders: true,
    agreed_by_user_id: '6f1d2c1e-0000-4000-8000-0000000000bb',
    agreed_on: '2026-10-20',
    closed_on: null,
    notes: '',
    created_at: '2026-10-20T08:00:00+00:00',
    updated_at: '2026-10-20T08:00:00+00:00',
    ...overrides,
  }
}

function installmentRow(overrides: Partial<ArrangementInstallmentRow> = {}): ArrangementInstallmentRow {
  return {
    id: '6f1d2c1e-0000-4000-8000-000000000101',
    company_id: COMPANY,
    arrangement_id: ARRANGEMENT,
    sequence: 1,
    due_date: '2026-11-01',
    amount: 12_600,
    status: 'confirmed_paid',
    reminder_sent_at: '2026-10-29T08:00:00+00:00',
    confirmed_by_user_id: '6f1d2c1e-0000-4000-8000-0000000000bb',
    confirmed_on: '2026-11-03',
    notes: null,
    created_at: '2026-10-20T08:00:00+00:00',
    updated_at: '2026-11-03T08:00:00+00:00',
    ...overrides,
  }
}

describe('ArrangementsService', () => {
  const service = new ArrangementsService()

  it('lists one company with filters and attaches instalments in order', async () => {
    const { client, queries } = fakeDb((query) =>
      query.table === 'payment_arrangements'
        ? { data: [arrangementRow(), arrangementRow({ id: OTHER, status: 'proposed' })], error: null, count: 2 }
        : {
            data: [installmentRow(), installmentRow({ id: 'i2', sequence: 2, due_date: '2026-12-01', status: 'scheduled', reminder_sent_at: null, confirmed_by_user_id: null, confirmed_on: null })],
            error: null,
          },
    )

    const page = await service.list(client, COMPANY, arrangementListQuerySchema.parse({ status: 'active', tenantId: TENANT, sort: 'firstInstallmentDate' }))

    expect(page.total).toBe(2)
    expect(page.items[0]).toMatchObject({ id: ARRANGEMENT, suppressArrearsReminders: true, outstandingBalance: 75_600 })
    expect(page.items[0]?.installments.map((i) => [i.sequence, i.status])).toEqual([
      [1, 'confirmed_paid'],
      [2, 'scheduled'],
    ])
    expect(page.items[0]?.installments[1]).not.toHaveProperty('confirmedOn')
    expect(page.items[0]).not.toHaveProperty('closedOn')
    expect(page.items[1]?.installments).toEqual([])

    expect(callsTo(queries[0]!, 'eq')).toEqual([
      ['company_id', COMPANY],
      ['status', 'active'],
      ['tenant_id', TENANT],
    ])
    expect(callsTo(queries[0]!, 'order')[0]).toEqual(['first_installment_date', { ascending: true }])
    expect(callsTo(queries[1]!, 'eq')).toEqual([['company_id', COMPANY]])
    expect(callsTo(queries[1]!, 'in')).toEqual([['arrangement_id', [ARRANGEMENT, OTHER]]])
  })

  it('returns every instalment of a page beyond the Data API max_rows limit, ordered for stable paging', async () => {
    const installments = [
      ...Array.from({ length: 1200 }, (_, index) => installmentRow({ id: `a-${index}`, sequence: index + 1 })),
      ...Array.from({ length: 300 }, (_, index) => installmentRow({ id: `b-${index}`, arrangement_id: OTHER, sequence: index + 1 })),
    ]
    const { client, queries } = fakeDb((query) =>
      query.table === 'payment_arrangements'
        ? { data: [arrangementRow(), arrangementRow({ id: OTHER })], error: null, count: 2 }
        : { data: dataApiPage(installments, query), error: null },
    )

    const page = await service.list(client, COMPANY, arrangementListQuerySchema.parse({}))

    expect(page.items[0]?.installments).toHaveLength(1200)
    expect(page.items[0]?.installments.at(-1)?.sequence).toBe(1200)
    expect(page.items[1]?.installments).toHaveLength(300)
    const installmentQueries = queries.filter((query) => query.table === 'arrangement_installments')
    expect(installmentQueries.map((query) => callsTo(query, 'range')[0])).toEqual([
      [0, 999],
      [1000, 1999],
    ])
    expect(callsTo(installmentQueries[0]!, 'order')).toEqual([
      ['arrangement_id', { ascending: true }],
      ['sequence', { ascending: true }],
      ['id', { ascending: true }],
    ])
  })

  it('returns 404 when the arrangement is not visible, without loading instalments', async () => {
    const { client, queries } = fakeDb(() => ({ data: null, error: null }))
    await expect(service.get(client, COMPANY, ARRANGEMENT)).rejects.toBeInstanceOf(NotFoundException)
    expect(queries).toHaveLength(1)
  })
})
