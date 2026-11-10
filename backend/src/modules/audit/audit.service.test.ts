import { ForbiddenException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'

import { callsTo, fakeDb } from '../../common/testing/fake-db.test-helpers'
import { AUDIT_READER_ROLES } from './audit.controller'
import { toAuditLogEntry, type AuditLogRow } from './audit.mapper'
import { auditLogListQuerySchema } from './audit.schemas'
import { AuditService } from './audit.service'

const COMPANY = '6f1d2c1e-0000-4000-8000-000000000001'
const ACTOR = '6f1d2c1e-0000-4000-8000-0000000000a1'
const ENTITY = '6f1d2c1e-0000-4000-8000-0000000000e1'

const row: AuditLogRow = {
  id: '6f1d2c1e-0000-4000-8000-0000000000f1',
  company_id: COMPANY,
  actor_user_id: ACTOR,
  action: 'approve',
  entity_type: 'message_approval',
  entity_id: ENTITY,
  summary: 'Message approval approved',
  changes: [{ field: 'decision', before: 'pending', after: 'approved' }],
  occurred_at: '2026-11-08T08:00:00+00:00',
  created_at: '2026-11-08T08:00:00+00:00',
}

describe('audit mapper', () => {
  it('maps changes and the actor', () => {
    expect(toAuditLogEntry(row)).toEqual({
      id: row.id,
      companyId: COMPANY,
      actorUserId: ACTOR,
      action: 'approve',
      entityType: 'message_approval',
      entityId: ENTITY,
      summary: 'Message approval approved',
      changes: [{ field: 'decision', before: 'pending', after: 'approved' }],
      occurredAt: row.occurred_at,
      createdAt: row.created_at,
      updatedAt: row.created_at,
    })
  })

  it('leaves the actor absent for background-job entries', () => {
    expect(toAuditLogEntry({ ...row, actor_user_id: null })).not.toHaveProperty('actorUserId')
  })

  it('keeps scalar changes, renders structured values as JSON text and drops malformed changes', () => {
    const structured = toAuditLogEntry({ ...row, changes: [{ field: 'leaseExpiryNoticeDays', before: [90, 60], after: 100.5 }] })
    expect(structured.changes).toEqual([{ field: 'leaseExpiryNoticeDays', before: '[90,60]', after: 100.5 }])
    expect(toAuditLogEntry({ ...row, changes: [{ before: 1 }] })).not.toHaveProperty('changes')
    expect(toAuditLogEntry({ ...row, changes: null })).not.toHaveProperty('changes')
  })
})

describe('auditLogListQuerySchema', () => {
  it('accepts inclusive South African date bounds and rejects impossible ones', () => {
    expect(auditLogListQuerySchema.parse({ from: '2026-11-01', to: '2026-11-01' })).toMatchObject({ direction: 'desc' })
    expect(auditLogListQuerySchema.safeParse({ from: '2026-11-09', to: '2026-11-01' }).success).toBe(false)
    expect(auditLogListQuerySchema.safeParse({ from: '2026-02-30' }).success).toBe(false)
    expect(auditLogListQuerySchema.safeParse({ action: 'erase' }).success).toBe(false)
  })
})

describe('AuditService', () => {
  const service = new AuditService()

  it('filters one company by entity, action, actor and date range', async () => {
    const { client, queries } = fakeDb(() => ({ data: [row], error: null, count: 1 }))
    const query = auditLogListQuerySchema.parse({
      entityType: 'message_approval',
      entityId: ENTITY,
      action: 'approve',
      actorUserId: ACTOR,
      from: '2026-11-01',
      to: '2026-11-30',
      search: 'approval',
    })

    const page = await service.list(client, COMPANY, query)

    expect(page.items).toHaveLength(1)
    const [q] = queries
    expect(q?.table).toBe('audit_logs')
    expect(callsTo(q!, 'eq')).toEqual([
      ['company_id', COMPANY],
      ['entity_type', 'message_approval'],
      ['entity_id', ENTITY],
      ['action', 'approve'],
      ['actor_user_id', ACTOR],
    ])
    expect(callsTo(q!, 'gte')).toEqual([['occurred_at', '2026-11-01T00:00:00+02:00']])
    expect(callsTo(q!, 'lt')).toEqual([['occurred_at', '2026-12-01T00:00:00+02:00']])
    expect(callsTo(q!, 'order')[0]).toEqual(['occurred_at', { ascending: false }])
    // Read-only: no write is ever issued.
    expect(q?.calls.some(([method]) => ['insert', 'update', 'upsert', 'delete'].includes(method))).toBe(false)
  })

  it('maps a policy denial to 403', async () => {
    const { client } = fakeDb(() => ({ data: null, error: { code: '42501', message: 'permission denied' } }))
    await expect(service.list(client, COMPANY, auditLogListQuerySchema.parse({}))).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('allows the same roles as the auditors_read policy (not property owners)', () => {
    expect([...AUDIT_READER_ROLES].sort()).toEqual(['company_admin', 'property_manager', 'read_only'])
  })
})
