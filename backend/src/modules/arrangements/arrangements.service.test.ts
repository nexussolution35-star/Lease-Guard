import { BadRequestException, ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'

import { callsTo, dataApiPage, fakeDb } from '../../common/testing/fake-db.test-helpers'
import type { ArrangementInstallmentRow, PaymentArrangementRow } from './arrangements.mapper'
import {
  arrangementListQuerySchema,
  cancelArrangementBodySchema,
  createArrangementBodySchema,
  installmentOutcomeBodySchema,
  updateArrangementBodySchema,
} from './arrangements.schemas'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
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
    closed_by_user_id: null,
    close_reason: null,
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
    outcome_recorded_by_user_id: '6f1d2c1e-0000-4000-8000-0000000000bb',
    outcome_recorded_at: '2026-11-03T08:00:00+00:00',
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

  it('names the tenant, property, unit and lease of every arrangement from to-one embeds', async () => {
    const { client, queries } = fakeDb((query) =>
      query.table === 'payment_arrangements'
        ? {
            data: [
              {
                ...arrangementRow(),
                tenant: { trading_name: 'Spur Steak Ranches' },
                unit: { unit_number: 'G12', property: { name: 'Menlyn Square' } },
                lease: { reference: 'MSQ-L012' },
              },
            ],
            error: null,
            count: 1,
          }
        : { data: [], error: null },
    )

    const page = await service.list(client, COMPANY, arrangementListQuerySchema.parse({}))

    expect(page.items[0]).toMatchObject({
      tenantName: 'Spur Steak Ranches',
      propertyName: 'Menlyn Square',
      unitNumber: 'G12',
      leaseReference: 'MSQ-L012',
    })
    expect(page.items[0]).not.toHaveProperty('tenant')
    expect(page.items[0]).not.toHaveProperty('unit')
    expect(String(callsTo(queries[0]!, 'select')[0]?.[0])).toContain('tenant:tenants!payment_arrangements_tenant_fk(trading_name)')
    expect(String(callsTo(queries[0]!, 'select')[0]?.[0])).toContain('lease:leases!payment_arrangements_lease_fk(reference)')
  })

  it('returns 404 when the arrangement is not visible, without loading instalments', async () => {
    const { client, queries } = fakeDb(() => ({ data: null, error: null }))
    await expect(service.get(client, COMPANY, ARRANGEMENT)).rejects.toBeInstanceOf(NotFoundException)
    expect(queries).toHaveLength(1)
  })
})

describe('ArrangementsService writes', () => {
  const service = new ArrangementsService()
  const LEASE = '6f1d2c1e-0000-4000-8000-0000000000cf'
  const PROPERTY = '6f1d2c1e-0000-4000-8000-0000000000cc'
  const INSTALLMENT = '6f1d2c1e-0000-4000-8000-000000000101'

  /** The rpc answers `rpcData`; the read-back answers the arrangement and its instalments. */
  function writeDb(rpcData: unknown = ARRANGEMENT) {
    return fakeDb((query) => {
      if (query.table.startsWith('rpc:')) return { data: rpcData, error: null }
      if (query.table === 'payment_arrangements') return { data: arrangementRow(), error: null }
      return { data: [installmentRow()], error: null }
    })
  }

  it('records through the database function, sending only the given terms, and returns the arrangement', async () => {
    const { client, queries } = writeDb()
    const body = createArrangementBodySchema.parse({
      tenantId: TENANT,
      propertyId: PROPERTY,
      leaseId: LEASE,
      outstandingBalance: 75_600,
      installmentAmount: 12_600,
      frequency: 'monthly',
      firstInstallmentDate: '2026-11-01',
      notes: '  Agreed at the centre office ',
    })
    await expect(service.create(client, COMPANY, body)).resolves.toMatchObject({ id: ARRANGEMENT, installments: [{ sequence: 1 }] })
    expect(queries[0]?.table).toBe('rpc:record_payment_arrangement')
    expect(callsTo(queries[0]!, 'rpc')).toEqual([
      [
        {
          p_company_id: COMPANY,
          p_tenant_id: TENANT,
          p_property_id: PROPERTY,
          p_lease_id: LEASE,
          p_outstanding_balance: 75_600,
          p_installment_amount: 12_600,
          p_frequency: 'monthly',
          p_first_installment_date: '2026-11-01',
          p_notes: 'Agreed at the centre office',
        },
      ],
    ])
  })

  it('answers the database in words: 422 for terms, 409 for a state conflict, 404 for another company', async () => {
    const body = createArrangementBodySchema.parse({
      tenantId: TENANT,
      propertyId: PROPERTY,
      outstandingBalance: 100,
      installmentAmount: 50,
      frequency: 'weekly',
      firstInstallmentDate: '2026-12-01',
    })
    const answer = (code: string, message: string) =>
      service.create(fakeDb(() => ({ data: null, error: { code, message } })).client, COMPANY, body).catch((caught: unknown) => caught)

    const terms = await answer('22023', 'The instalment amount cannot be more than the outstanding balance.')
    expect(terms).toBeInstanceOf(UnprocessableEntityException)
    expect((terms as Error).message).toBe('The instalment amount cannot be more than the outstanding balance.')
    const active = await answer('P0001', 'Kasi Flame Grill already has an active payment arrangement (agreed on 01 Nov 2026). Close or cancel it first.')
    expect(active).toBeInstanceOf(ConflictException)
    expect((active as Error).message).toContain('already has an active payment arrangement')
    expect(await answer('P0002', 'The tenant is not in this workspace')).toBeInstanceOf(NotFoundException)
  })

  it('edits only the given fields', async () => {
    const { client, queries } = writeDb()
    await service.update(client, COMPANY, ARRANGEMENT, updateArrangementBodySchema.parse({ installmentAmount: 5_000, status: 'active' }))
    expect(callsTo(queries[0]!, 'rpc')).toEqual([
      [{ p_company_id: COMPANY, p_arrangement_id: ARRANGEMENT, p_installment_amount: 5_000, p_status: 'active' }],
    ])
  })

  it('closes and cancels through the one database function', async () => {
    const closing = writeDb()
    await service.close(closing.client, COMPANY, ARRANGEMENT, { outcome: 'completed' })
    expect(callsTo(closing.queries[0]!, 'rpc')).toEqual([[{ p_company_id: COMPANY, p_arrangement_id: ARRANGEMENT, p_status: 'completed' }]])

    const cancelling = writeDb()
    await service.cancel(cancelling.client, COMPANY, ARRANGEMENT, cancelArrangementBodySchema.parse({ reason: ' Paid in full ' }))
    expect(cancelling.queries[0]?.table).toBe('rpc:close_payment_arrangement')
    expect(callsTo(cancelling.queries[0]!, 'rpc')).toEqual([
      [{ p_company_id: COMPANY, p_arrangement_id: ARRANGEMENT, p_status: 'cancelled', p_reason: 'Paid in full' }],
    ])
  })

  it('records an instalment outcome as the manager confirms it', async () => {
    const { client, queries } = writeDb(INSTALLMENT)
    await service.recordInstallmentOutcome(client, COMPANY, ARRANGEMENT, INSTALLMENT, installmentOutcomeBodySchema.parse({ outcome: 'missed', note: 'Tenant confirmed' }))
    expect(queries[0]?.table).toBe('rpc:record_arrangement_installment_outcome')
    expect(callsTo(queries[0]!, 'rpc')).toEqual([
      [{ p_company_id: COMPANY, p_arrangement_id: ARRANGEMENT, p_installment_id: INSTALLMENT, p_status: 'missed', p_note: 'Tenant confirmed' }],
    ])
  })
})

describe('arrangement write bodies', () => {
  const pipe = <S extends ConstructorParameters<typeof ZodValidationPipe>[0]>(schema: S) => new ZodValidationPipe(schema)

  it('refuses unknown fields, amounts at or below zero, more than two decimals, a closing status and an empty edit', () => {
    const valid = {
      tenantId: TENANT,
      propertyId: '6f1d2c1e-0000-4000-8000-0000000000cc',
      outstandingBalance: 100,
      installmentAmount: 50,
      frequency: 'monthly',
      firstInstallmentDate: '2026-12-01',
    }
    expect(() => pipe(createArrangementBodySchema).transform(valid)).not.toThrow()
    for (const body of [
      { ...valid, paymentReference: 'x' },
      { ...valid, installmentAmount: 0 },
      { ...valid, outstandingBalance: 10.005 },
      { ...valid, status: 'completed' },
      { ...valid, firstInstallmentDate: '2026-02-30' },
    ]) {
      expect(() => pipe(createArrangementBodySchema).transform(body)).toThrow(BadRequestException)
    }
    expect(() => pipe(updateArrangementBodySchema).transform({})).toThrow(BadRequestException)
    expect(() => pipe(cancelArrangementBodySchema).transform({ reason: '   ' })).toThrow(BadRequestException)
    expect(() => pipe(installmentOutcomeBodySchema).transform({ outcome: 'reminder_sent' })).toThrow(BadRequestException)
  })
})
