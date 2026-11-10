import { describe, expect, it } from 'vitest'
import { TENANT_MESSAGE_TYPES } from '../types/index.js'
import { makeArrangement, makeOwner, makeTenant } from './__fixtures__/lease.js'
import {
  approvalBlocker,
  assertNeverTenantTopic,
  canSendOwnerMessage,
  canSendTenantMessage,
  FORBIDDEN_TENANT_TOPICS,
  ForbiddenTenantTopicError,
  isTenantMessageType,
  type TenantMessageContext,
} from './communicationEligibility.js'

const today = '2026-11-06'
const baseCtx: TenantMessageContext = {
  approval: { decision: 'approved' },
  arrangements: [],
  today,
}

describe('tenant topic guards', () => {
  it('lists forbidden topics and recognises permitted types', () => {
    expect(FORBIDDEN_TENANT_TOPICS).toContain('lease_expiry')
    expect(FORBIDDEN_TENANT_TOPICS).toContain('rental_escalation')
    for (const t of TENANT_MESSAGE_TYPES) expect(isTenantMessageType(t)).toBe(true)
    expect(isTenantMessageType('owner_weekly_summary')).toBe(false)
  })
  it('assertNeverTenantTopic throws for non-tenant types', () => {
    expect(assertNeverTenantTopic('monthly_statement')).toBe('monthly_statement')
    expect(() => assertNeverTenantTopic('owner_weekly_summary')).toThrow(ForbiddenTenantTopicError)
    expect(() => assertNeverTenantTopic('lease_expiry')).toThrow(/never be sent to a tenant/)
  })
})

describe('canSendTenantMessage', () => {
  it('happy path', () => {
    expect(canSendTenantMessage(makeTenant(), 'monthly_statement', baseCtx)).toEqual({ eligible: true, reasons: [] })
  })
  it('rejects non-tenant message types', () => {
    const r = canSendTenantMessage(makeTenant(), 'owner_weekly_summary', baseCtx)
    expect(r.eligible).toBe(false)
    expect(r.reasons[0]).toMatch(/not permitted for tenants/)
    expect(canSendTenantMessage(makeTenant(), 'manual', baseCtx).eligible).toBe(false)
  })
  it('tenant state blockers', () => {
    expect(canSendTenantMessage(makeTenant({ whatsappVerified: false }), 'monthly_statement', baseCtx).reasons).toEqual(['Tenant WhatsApp number has not been verified'])
    expect(canSendTenantMessage(makeTenant({ whatsappOptedOut: true }), 'monthly_statement', baseCtx).reasons).toEqual(['Tenant has opted out of WhatsApp communication'])
    expect(canSendTenantMessage(makeTenant({ status: 'vacated' }), 'monthly_statement', baseCtx).reasons).toEqual(['Tenant has vacated'])
    expect(canSendTenantMessage(makeTenant({ status: 'in_arrears' }), 'overdue_payment_reminder', baseCtx).eligible).toBe(true)
  })
  it('approval gate: always required, with no setting that relaxes it', () => {
    const ctx: TenantMessageContext = { arrangements: [], today }
    expect(canSendTenantMessage(makeTenant(), 'monthly_statement', ctx).reasons).toEqual(['Property manager approval is required before sending'])
    expect(canSendTenantMessage(makeTenant(), 'monthly_statement', { ...ctx, approval: { decision: 'pending' } }).eligible).toBe(false)
    expect(canSendTenantMessage(makeTenant(), 'monthly_statement', { ...ctx, approval: { decision: 'rejected' } }).reasons).toEqual(['Message approval was rejected'])
    expect(canSendTenantMessage(makeTenant(), 'monthly_statement', { ...ctx, approval: { decision: 'approved' } }).eligible).toBe(true)
  })
  it('approvalBlocker: only an approved decision allows sending', () => {
    expect(approvalBlocker({ decision: 'approved' })).toBeUndefined()
    expect(approvalBlocker({ decision: 'pending' })).toBe('Property manager approval is required before sending')
    expect(approvalBlocker(undefined)).toBe('Property manager approval is required before sending')
    expect(approvalBlocker({ decision: 'rejected' })).toBe('Message approval was rejected')
  })
  it('arrears reminders suppressed by active arrangement; instalment reminders need one', () => {
    const withArr: TenantMessageContext = { ...baseCtx, arrangements: [makeArrangement({ tenantId: 'ten_test' })] }
    expect(canSendTenantMessage(makeTenant(), 'overdue_payment_reminder', withArr).reasons).toEqual(['Arrears reminders are paused by an active payment arrangement'])
    expect(canSendTenantMessage(makeTenant(), 'monthly_statement', withArr).eligible).toBe(true)
    expect(canSendTenantMessage(makeTenant(), 'arrangement_installment_reminder', withArr).eligible).toBe(true)
    expect(canSendTenantMessage(makeTenant(), 'arrangement_installment_reminder', baseCtx).reasons).toEqual(['No active payment arrangement exists for this tenant'])
    const noSuppress: TenantMessageContext = { ...baseCtx, arrangements: [makeArrangement({ suppressArrearsReminders: false })] }
    expect(canSendTenantMessage(makeTenant(), 'initial_payment_reminder', noSuppress).eligible).toBe(true)
  })
  it('accumulates multiple reasons', () => {
    const r = canSendTenantMessage(makeTenant({ whatsappVerified: false, whatsappOptedOut: true }), 'lease_expiry' as never, baseCtx)
    expect(r.reasons).toHaveLength(3)
  })
})

describe('canSendOwnerMessage', () => {
  it('owner checks', () => {
    expect(canSendOwnerMessage(makeOwner(), 'owner_weekly_summary', 'cmp_nexus')).toEqual({ eligible: true, reasons: [] })
    expect(canSendOwnerMessage(makeOwner(), 'monthly_statement').reasons).toEqual(['Message type "monthly_statement" is not an owner message'])
    expect(canSendOwnerMessage(makeOwner({ whatsappNumber: undefined }), 'owner_query_response').reasons).toEqual(['Owner has no WhatsApp number on record'])
    expect(canSendOwnerMessage(makeOwner({ status: 'suspended' }), 'owner_weekly_summary').reasons).toEqual(['Owner user is suspended'])
    expect(canSendOwnerMessage(makeOwner(), 'owner_weekly_summary', 'cmp_other').reasons).toEqual(['User is not a property owner in this company'])
  })
})
