import { renderHook } from '@testing-library/react'
import { act } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  DEMO_COMPANY_IDS,
  DEMO_REFERENCE_DATE,
  EVENT_IDS,
  LEASE_IDS,
  PROPERTY_IDS,
  RULE_IDS,
  STATEMENT_IDS,
  TENANT_IDS,
  UNIT_IDS,
} from '@/services/demo/seed'
import { useAppStore } from '@/store/appStore'

import { getReminderSuppressionStatus, useReminderSuppressionStatus } from '@/services/arrangements'
import {
  getEventContext,
  getLeaseContext,
  getPropertyContext,
  getTenantCommunicationHistory,
  getTenantContext,
  getUnitContext,
  useLeaseContext,
  useTenantContext,
} from '@/services/context'

const TODAY = DEMO_REFERENCE_DATE

beforeEach(() => {
  localStorage.clear()
  useAppStore.getState().resetDemoData()
})

describe('detail contexts', () => {
  it('event context resolves its lease, statement, extraction and rule sources', () => {
    const ctx = getEventContext(EVENT_IDS.escalationPharmaCare)
    expect(ctx?.lease?.id).toBe(LEASE_IDS.msqL002)
    expect(ctx?.statement?.id).toBe(STATEMENT_IDS.msqPharmaCare202610)
    expect(ctx?.extraction?.statementId).toBe(STATEMENT_IDS.msqPharmaCare202610)
    expect(ctx?.rule?.id).toBe(RULE_IDS.nexus.rental_escalation_discrepancy)
    expect(ctx?.tenant?.id).toBe(TENANT_IDS.pharmaCare)
    expect(ctx?.property?.id).toBe(PROPERTY_IDS.msq)
  })

  it('lease context joins tenant, unit, property, documents, events and statements', () => {
    const ctx = getLeaseContext(LEASE_IDS.msqL002)
    expect(ctx?.tenant?.id).toBe(TENANT_IDS.pharmaCare)
    expect(ctx?.unit?.id).toBe(UNIT_IDS.msqS02)
    expect(ctx?.property?.id).toBe(PROPERTY_IDS.msq)
    expect(ctx?.documents.every((d) => d.leaseId === LEASE_IDS.msqL002)).toBe(true)
    expect(ctx?.documents.length).toBeGreaterThan(0)
    expect(ctx?.events.map((e) => e.id)).toContain(EVENT_IDS.escalationPharmaCare)
    expect(ctx?.statements.map((s) => s.id)).toContain(STATEMENT_IDS.msqPharmaCare202610)
  })

  it('property and unit contexts', () => {
    const p = getPropertyContext(PROPERTY_IDS.msq)
    expect(p?.units.every((u) => u.propertyId === PROPERTY_IDS.msq)).toBe(true)
    expect(p?.stats.unitCount).toBe(p?.units.length)
    expect(p?.owner?.id).toBeDefined()
    const u = getUnitContext(UNIT_IDS.msqS02)
    expect(u?.currentLease?.id).toBe(LEASE_IDS.msqL002)
    expect(u?.tenant?.id).toBe(TENANT_IDS.pharmaCare)
  })

  it('tenant context includes communication history and reminder suppression', () => {
    const ctx = getTenantContext(TENANT_IDS.dlaminiCellular, TODAY)
    expect(ctx?.reminderSuppression.suppressed).toBe(true)
    expect(ctx?.reminderSuppression.arrangementId).toBeDefined()
    expect(ctx?.communications.every((c) => c.tenantId === TENANT_IDS.dlaminiCellular)).toBe(true)
    expect(ctx?.communications.length).toBeGreaterThan(0)
    expect(getReminderSuppressionStatus(TENANT_IDS.thriftyFoods, TODAY).suppressed).toBe(false)
  })

  it('never joins records from another company', () => {
    useAppStore.getState().switchWorkspace(DEMO_COMPANY_IDS.second)
    expect(getLeaseContext(LEASE_IDS.msqL002)).toBeUndefined()
    expect(getEventContext(EVENT_IDS.escalationPharmaCare)).toBeUndefined()
    expect(getTenantContext(TENANT_IDS.dlaminiCellular, TODAY)).toBeUndefined()
    expect(getTenantCommunicationHistory(TENANT_IDS.dlaminiCellular)).toEqual([])
  })

  it('hooks react to workspace switches and mutations', () => {
    const lease = renderHook(() => useLeaseContext(LEASE_IDS.msqL002))
    const tenant = renderHook(() => useTenantContext(TENANT_IDS.dlaminiCellular, TODAY))
    const sup = renderHook(() => useReminderSuppressionStatus(TENANT_IDS.dlaminiCellular, TODAY))
    expect(lease.result.current?.lease.id).toBe(LEASE_IDS.msqL002)
    expect(sup.result.current?.suppressed).toBe(true)
    act(() => useAppStore.getState().switchWorkspace(DEMO_COMPANY_IDS.second))
    expect(lease.result.current).toBeUndefined()
    expect(tenant.result.current).toBeUndefined()
    expect(sup.result.current?.suppressed).toBe(false)
  })
})
