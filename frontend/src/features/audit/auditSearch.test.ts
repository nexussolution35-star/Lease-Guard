import { describe, expect, it } from 'vitest'

import { auditSearchSchema, hasAuditFilters } from './auditSearch'

const ACTOR = '5b0c1d2e-0000-4000-8000-0000000000a2'

describe('auditSearchSchema', () => {
  it('defaults to the first page without filters', () => {
    const search = auditSearchSchema.parse({})
    expect(search).toMatchObject({ page: 1, pageSize: 25 })
    expect(hasAuditFilters(search)).toBe(false)
  })

  it('keeps valid filters', () => {
    const search = auditSearchSchema.parse({ page: '3', action: 'verify', entityType: 'lease', actor: ACTOR, from: '2026-10-01', to: '2026-10-31' })
    expect(search).toEqual({ page: 3, pageSize: 25, action: 'verify', entityType: 'lease', actor: ACTOR, from: '2026-10-01', to: '2026-10-31' })
    expect(hasAuditFilters(search)).toBe(true)
  })

  it('drops values the API would refuse', () => {
    const search = auditSearchSchema.parse({ page: '0', pageSize: '5000', action: 'hack', entityType: 'payment', actor: 'me', from: '2026-02-30', to: 'soon' })
    expect(search).toMatchObject({ page: 1, pageSize: 25 })
    expect(hasAuditFilters(search)).toBe(false)
  })

  it('drops the end of a range that ends before it starts', () => {
    const search = auditSearchSchema.parse({ from: '2026-11-10', to: '2026-11-01' })
    expect(search.from).toBe('2026-11-10')
    expect(search.to).toBeUndefined()
  })
})
