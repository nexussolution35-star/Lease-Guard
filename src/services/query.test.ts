import { describe, expect, it } from 'vitest'

import { applyQuery, compareValues } from '@/services/query'

interface Row {
  id: string
  name: string
  code: string
  amount: number
  status: 'active' | 'archived' | 'draft'
  createdAt: string
  dueDate?: string
}

const rows: Row[] = [
  { id: '1', name: 'Mall of Soweto', code: 'MSQ', amount: 350_000, status: 'active', createdAt: '2026-01-10T08:00:00+02:00', dueDate: '2026-03-01' },
  { id: '2', name: 'Umhlanga Office Park', code: 'UOP', amount: 84_000, status: 'active', createdAt: '2025-12-01T08:00:00+02:00' },
  { id: '3', name: 'Sandton Logistics Hub', code: 'SLH', amount: 1_200_000, status: 'archived', createdAt: '2026-02-20T08:00:00+02:00', dueDate: '2026-01-15' },
  { id: '4', name: 'Soweto Clinic Centre', code: 'SCC', amount: 42_500.5, status: 'draft', createdAt: '2026-02-01T08:00:00+02:00', dueDate: '2026-02-01' },
]

describe('applyQuery', () => {
  it('returns everything unpaged by default', () => {
    const result = applyQuery(rows)
    expect(result.items).toHaveLength(4)
    expect(result.total).toBe(4)
    expect(result.page).toBe(1)
    expect(result.pageCount).toBe(1)
  })

  it('searches case-insensitively across searchFields', () => {
    const result = applyQuery(rows, { search: 'soweto', searchFields: ['name', 'code'] })
    expect(result.items.map((r) => r.id)).toEqual(['1', '4'])
    const byCode = applyQuery(rows, { search: 'uop', searchFields: ['name', 'code'] })
    expect(byCode.items.map((r) => r.id)).toEqual(['2'])
  })

  it('ignores search without searchFields and ignores whitespace-only search', () => {
    expect(applyQuery(rows, { search: 'soweto' }).total).toBe(4)
    expect(applyQuery(rows, { search: '   ', searchFields: ['name'] }).total).toBe(4)
  })

  it('applies equality filters and IN filters for arrays', () => {
    expect(applyQuery(rows, { filters: { status: 'active' } }).items.map((r) => r.id)).toEqual(['1', '2'])
    expect(applyQuery(rows, { filters: { status: ['archived', 'draft'] } }).items.map((r) => r.id)).toEqual(['3', '4'])
    expect(applyQuery(rows, { filters: { status: undefined } }).total).toBe(4)
  })

  it('sorts strings, numbers and ISO dates in both directions', () => {
    expect(applyQuery(rows, { sort: { field: 'name', direction: 'asc' } }).items.map((r) => r.id)).toEqual(['1', '3', '4', '2'])
    expect(applyQuery(rows, { sort: { field: 'amount', direction: 'desc' } }).items.map((r) => r.id)).toEqual(['3', '1', '2', '4'])
    expect(applyQuery(rows, { sort: { field: 'createdAt', direction: 'asc' } }).items.map((r) => r.id)).toEqual(['2', '1', '4', '3'])
  })

  it('always sorts undefined values last', () => {
    expect(applyQuery(rows, { sort: { field: 'dueDate', direction: 'asc' } }).items.map((r) => r.id)).toEqual(['3', '4', '1', '2'])
    expect(applyQuery(rows, { sort: { field: 'dueDate', direction: 'desc' } }).items.map((r) => r.id)).toEqual(['1', '4', '3', '2'])
  })

  it('paginates and clamps out-of-range pages', () => {
    const page1 = applyQuery(rows, { page: 1, pageSize: 3, sort: { field: 'id', direction: 'asc' } })
    expect(page1.items.map((r) => r.id)).toEqual(['1', '2', '3'])
    expect(page1.pageCount).toBe(2)
    const page2 = applyQuery(rows, { page: 2, pageSize: 3, sort: { field: 'id', direction: 'asc' } })
    expect(page2.items.map((r) => r.id)).toEqual(['4'])
    const beyond = applyQuery(rows, { page: 9, pageSize: 3, sort: { field: 'id', direction: 'asc' } })
    expect(beyond.page).toBe(2)
    expect(beyond.items.map((r) => r.id)).toEqual(['4'])
    const zero = applyQuery(rows, { page: 0, pageSize: 0 })
    expect(zero.page).toBe(1)
    expect(zero.pageSize).toBe(1)
  })

  it('handles empty input', () => {
    const result = applyQuery<Row>([], { page: 3, pageSize: 10 })
    expect(result).toEqual({ items: [], total: 0, page: 1, pageSize: 10, pageCount: 1 })
  })

  it('does not mutate the input array', () => {
    const copy = [...rows]
    applyQuery(rows, { sort: { field: 'amount', direction: 'desc' } })
    expect(rows).toEqual(copy)
  })
})

describe('compareValues', () => {
  it('orders numbers numerically and missing values last', () => {
    expect(compareValues(2, 10)).toBeLessThan(0)
    expect(compareValues('10', '9')).toBeLessThan(0)
    expect(compareValues(undefined, 1)).toBeGreaterThan(0)
    expect(compareValues(null, undefined)).toBe(0)
    expect(compareValues(true, false)).toBeGreaterThan(0)
  })
})
