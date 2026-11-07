import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createFixtureCollections, FIXTURE_IDS, FIXTURE_WORKSPACE } from '@/store/testFixtures'
import type { TenantMessageType } from '@/types'

vi.mock('@/data', () => ({
  DEMO_REFERENCE_DATE: '2026-11-06',
  DEMO_COMPANY_IDS: { nexus: 'cmp_nexus', second: 'cmp_atlas' },
  DEMO_DEFAULT_USER_ID: 'usr_thandi',
  createDemoSeed: () => createFixtureCollections(),
}))

const { useAppStore } = await import('@/store/appStore')
const services = await import('@/services')

const { nexus, atlas } = FIXTURE_IDS.companies
const FILE = {
  fileName: 'MSQ-L001-2026-11.pdf',
  storagePath: 'statements/cmp_nexus/MSQ-L001-2026-11.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 1000,
  sha256: 'b'.repeat(64),
} as const

function auditFor(entityId: string) {
  return Object.values(useAppStore.getState().collections.auditLogs).filter((l) => l.entityId === entityId)
}

beforeEach(() => {
  localStorage.clear()
  useAppStore.getState().hydrateFrom(createFixtureCollections(), { ...FIXTURE_WORKSPACE })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('repository scoping', () => {
  it('lists only the active company records', () => {
    expect(services.propertiesRepo.listAll().map((p) => p.companyId)).toEqual([nexus])
    expect(services.unitsRepo.count()).toBe(2)
    expect(services.tenantsRepo.list().items.map((t) => t.id)).toEqual([FIXTURE_IDS.tenants.pickNPay])
  })

  it('getById returns undefined for another company record', () => {
    expect(services.propertiesRepo.getById(FIXTURE_IDS.properties.umhlanga)).toBeUndefined()
    expect(services.propertiesRepo.getById(FIXTURE_IDS.properties.soweto)?.code).toBe('MSQ')
    expect(services.propertiesRepo.getById(undefined)).toBeUndefined()
    expect(() => services.propertiesRepo.require(FIXTURE_IDS.properties.umhlanga)).toThrow(/not found/)
  })

  it('workspace switch changes list results', () => {
    useAppStore.getState().switchWorkspace(atlas)
    expect(services.propertiesRepo.listAll().map((p) => p.id)).toEqual([FIXTURE_IDS.properties.umhlanga])
    expect(services.unitsRepo.listAll().map((u) => u.id)).toEqual([FIXTURE_IDS.units.umhlangaB1])
    expect(services.getActiveCompany().name).toBe('Atlas Property Group')
    expect(services.getCurrentUser().id).toBe(FIXTURE_IDS.users.sipho)
  })

  it('update refuses records from another company', () => {
    expect(() => services.unitsRepo.update(FIXTURE_IDS.units.umhlangaB1, { floor: '2' })).toThrow(/not found/)
  })
})

describe('repository mutations', () => {
  it('create assigns id, companyId, timestamps and an audit row', () => {
    const unit = services.createUnit({
      propertyId: FIXTURE_IDS.properties.soweto,
      unitNumber: 'A3',
      type: 'kiosk',
      floorAreaSqm: 12,
      occupancyStatus: 'vacant',
    })
    expect(unit.id).toMatch(/^unit_/)
    expect(unit.companyId).toBe(nexus)
    expect(unit.createdAt).toMatch(/\+02:00$/)
    expect(unit.updatedAt).toBe(unit.createdAt)
    expect(useAppStore.getState().collections.units[unit.id]).toEqual(unit)

    const audit = auditFor(unit.id)
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({
      action: 'create',
      entityType: 'unit',
      companyId: nexus,
      actorUserId: FIXTURE_IDS.users.thandi,
      summary: 'Unit created',
    })
  })

  it('update records a shallow scalar diff', () => {
    const updated = services.updateUnit(FIXTURE_IDS.units.sowetoA2, { floorAreaSqm: 200, description: 'Corner shop' })
    expect(updated.floorAreaSqm).toBe(200)
    const audit = auditFor(FIXTURE_IDS.units.sowetoA2)
    expect(audit).toHaveLength(1)
    expect(audit[0].action).toBe('update')
    expect(audit[0].changes).toEqual(
      expect.arrayContaining([
        { field: 'floorAreaSqm', before: 180, after: 200 },
        { field: 'description', before: null, after: 'Corner shop' },
      ]),
    )
    expect(audit[0].changes?.some((c) => c.field === 'updatedAt')).toBe(false)
  })

  it('archive patches the configured field; remove deletes', () => {
    const archived = services.archiveProperty(FIXTURE_IDS.properties.soweto)
    expect(archived.status).toBe('archived')
    expect(auditFor(FIXTURE_IDS.properties.soweto)[0]).toMatchObject({ action: 'archive', summary: 'Property archived' })
    // Units untouched.
    expect(useAppStore.getState().collections.units[FIXTURE_IDS.units.sowetoA1].occupancyStatus).toBe('occupied')

    services.removeUnit(FIXTURE_IDS.units.sowetoA2)
    expect(useAppStore.getState().collections.units[FIXTURE_IDS.units.sowetoA2]).toBeUndefined()
    expect(auditFor(FIXTURE_IDS.units.sowetoA2)[0].action).toBe('delete')
    expect(services.unitsRepo.archive(FIXTURE_IDS.units.sowetoA1)).toBeUndefined()
  })

  it('paginates, sorts and searches through the repository', () => {
    for (const n of ['B1', 'B2', 'B3', 'A9']) {
      services.createUnit({ propertyId: FIXTURE_IDS.properties.soweto, unitNumber: n, type: 'line_shop', floorAreaSqm: 50, occupancyStatus: 'vacant' })
    }
    const page = services.listUnits({ sort: { field: 'unitNumber', direction: 'asc' }, page: 2, pageSize: 4 })
    expect(page.total).toBe(6)
    expect(page.pageCount).toBe(2)
    expect(page.items.map((u) => u.unitNumber)).toEqual(['B2', 'B3'])
    expect(services.listUnits({ search: 'b' }).items.map((u) => u.unitNumber).sort()).toEqual(['B1', 'B2', 'B3'])
    expect(services.listUnits({ filters: { occupancyStatus: 'occupied' } }).items.map((u) => u.unitNumber)).toEqual(['A1'])
  })
})

describe('companies and users', () => {
  it('updates company settings with a settings diff', () => {
    const company = services.updateSettings({ requireApprovalForTenantMessages: false, installmentReminderLeadDays: 3 })
    expect(company.settings.requireApprovalForTenantMessages).toBe(false)
    const audit = auditFor(nexus)
    expect(audit[0].changes).toEqual(
      expect.arrayContaining([
        { field: 'requireApprovalForTenantMessages', before: true, after: false },
        { field: 'installmentReminderLeadDays', before: 2, after: 3 },
      ]),
    )
    expect(services.listCompanies()).toHaveLength(2)
  })

  it('lists company users via memberships and invites new users', () => {
    expect(services.listCompanyUsers().map((u) => u.id).sort()).toEqual([FIXTURE_IDS.users.sipho, FIXTURE_IDS.users.thandi])
    const invited = services.inviteUser({ fullName: 'Naledi Khumalo', email: 'naledi@nexussolution.co.za', role: 'read_only' })
    expect(invited.status).toBe('invited')
    expect(invited.memberships).toEqual([expect.objectContaining({ companyId: nexus, role: 'read_only', isDefault: true })])
    expect(services.listCompanyUsers()).toHaveLength(3)

    const promoted = services.setRole(invited.id, 'property_manager')
    expect(promoted.memberships[0].role).toBe('property_manager')
    expect(auditFor(invited.id).map((l) => l.action)).toEqual(['create', 'update'])
  })

  it('derives permissions from the current role', () => {
    expect(services.getCurrentRole()).toBe('property_manager')
    expect(services.getPermissions('property_manager').approveMessages).toBe(true)
    expect(services.getPermissions('read_only').manageLeases).toBe(false)
    expect(services.getPermissions(undefined)).toEqual(services.ROLE_PERMISSIONS.read_only)
  })
})

describe('units and leases', () => {
  it('assignTenant / releaseUnit keep denormalised fields consistent', () => {
    const assigned = services.assignTenant(FIXTURE_IDS.units.sowetoA2, FIXTURE_IDS.tenants.pickNPay, FIXTURE_IDS.leases.pickNPay)
    expect(assigned).toMatchObject({
      occupancyStatus: 'occupied',
      currentTenantId: FIXTURE_IDS.tenants.pickNPay,
      currentLeaseId: FIXTURE_IDS.leases.pickNPay,
    })
    const released = services.releaseUnit(FIXTURE_IDS.units.sowetoA2)
    expect(released.occupancyStatus).toBe('vacant')
    expect(released.currentTenantId).toBeUndefined()
    expect(released.currentLeaseId).toBeUndefined()
  })

  it('verifyLease stamps verifier and writes a verify audit', () => {
    useAppStore.getState().switchWorkspace(atlas)
    const lease = services.verifyLease(FIXTURE_IDS.leases.coastalLaw)
    expect(lease).toMatchObject({ verified: true, verifiedByUserId: FIXTURE_IDS.users.sipho, status: 'active' })
    expect(lease.verifiedAt).toMatch(/\+02:00$/)
    expect(auditFor(FIXTURE_IDS.leases.coastalLaw)[0]).toMatchObject({ action: 'verify', companyId: atlas })
  })

  it('renewLease creates a linked new lease and re-points the unit', () => {
    const renewal = services.renewLease(FIXTURE_IDS.leases.pickNPay, {
      reference: 'MSQ-L001-R1',
      commencementDate: '2029-03-01',
      expiryDate: '2034-02-28',
      initialMonthlyRental: 440_899.2,
    })
    expect(renewal.previousLeaseId).toBe(FIXTURE_IDS.leases.pickNPay)
    expect(renewal.status).toBe('pending_verification')
    expect(renewal.verified).toBe(false)
    expect(renewal.unitId).toBe(FIXTURE_IDS.units.sowetoA1)
    const old = services.getLease(FIXTURE_IDS.leases.pickNPay)
    expect(old?.status).toBe('renewed')
    expect(old?.renewalOption.exercised).toBe(true)
    expect(services.getUnit(FIXTURE_IDS.units.sowetoA1)?.currentLeaseId).toBe(renewal.id)
  })

  it('terminateLease releases the unit', () => {
    services.terminateLease(FIXTURE_IDS.leases.pickNPay, 'Tenant relocated')
    expect(services.getLease(FIXTURE_IDS.leases.pickNPay)?.status).toBe('terminated')
    expect(services.getUnit(FIXTURE_IDS.units.sowetoA1)?.occupancyStatus).toBe('vacant')
  })
})

describe('statements', () => {
  it('uploadStatement creates an uploaded record with an upload audit', () => {
    const statement = services.uploadStatement({
      propertyId: FIXTURE_IDS.properties.soweto,
      file: FILE,
      sourceSystem: 'MRI',
      statementDate: '2026-11-01',
      periodStart: '2026-11-01',
      periodEnd: '2026-11-30',
    })
    expect(statement.status).toBe('uploaded')
    expect(statement.uploadedByUserId).toBe(FIXTURE_IDS.users.thandi)
    expect(statement.lineItems).toEqual([])
    expect(auditFor(statement.id)[0].action).toBe('upload')
    expect(services.findStatementBySha256(FILE.sha256)?.id).toBe(statement.id)
  })

  it('confirmExtraction applies corrections and verifies the statement', () => {
    const statement = services.confirmExtraction(FIXTURE_IDS.statements.pickNPayOct, { paymentsReceived: 408_240, closingBalance: 61_000 })
    expect(statement.status).toBe('verified')
    expect(statement.rentalCharged).toBe(408_240)
    expect(statement.paymentsReceived).toBe(408_240)
    expect(statement.closingBalance).toBe(61_000)
    expect(statement.verifiedByUserId).toBe(FIXTURE_IDS.users.thandi)
    const extraction = services.getExtraction(FIXTURE_IDS.extractions.pickNPayOct)
    expect(extraction?.status).toBe('corrected')
    expect(extraction?.fields.find((f) => f.name === 'payments_received')?.correctedValue).toBe(408_240)
    expect(extraction?.fields.find((f) => f.name === 'rental_charged')?.correctedValue).toBeUndefined()
    expect(auditFor(FIXTURE_IDS.statements.pickNPayOct)[0].action).toBe('verify')
  })

  it('markDuplicate and rejectStatement', () => {
    const dup = services.uploadStatement({
      propertyId: FIXTURE_IDS.properties.soweto,
      file: { ...FILE, sha256: 'a'.repeat(64) },
      sourceSystem: 'MRI',
      statementDate: '2026-10-01',
      periodStart: '2026-10-01',
      periodEnd: '2026-10-31',
    })
    expect(services.markDuplicate(dup.id, FIXTURE_IDS.statements.pickNPayOct)).toMatchObject({
      status: 'duplicate',
      duplicateOfStatementId: FIXTURE_IDS.statements.pickNPayOct,
    })
    const rejected = services.rejectStatement(FIXTURE_IDS.statements.pickNPayOct, 'Wrong tenant')
    expect(rejected.status).toBe('rejected')
    expect(services.getExtraction(FIXTURE_IDS.extractions.pickNPayOct)?.status).toBe('rejected')
    expect(services.listStatementsForTenant(FIXTURE_IDS.tenants.pickNPay)).toHaveLength(1)
  })
})

describe('monitoring events', () => {
  const id = FIXTURE_IDS.events.escalation

  it('follows the allowed forward transitions', () => {
    expect(services.transitionEvent(id, 'under_review').status).toBe('under_review')
    expect(services.transitionEvent(id, 'action_required').status).toBe('action_required')
    expect(services.transitionEvent(id, 'in_progress').status).toBe('in_progress')
    const resolved = services.transitionEvent(id, 'resolved', 'Escalation confirmed with MRI')
    expect(resolved).toMatchObject({ status: 'resolved', resolvedByUserId: FIXTURE_IDS.users.thandi, resolutionNotes: 'Escalation confirmed with MRI' })
    expect(auditFor(id).at(-1)?.action).toBe('resolve')
    expect(() => services.transitionEvent(id, 'new')).toThrow(/Cannot move event/)
  })

  it('rejects skipping steps and requires a reason to dismiss', () => {
    expect(() => services.transitionEvent(id, 'resolved')).toThrow(/Cannot move event/)
    expect(() => services.transitionEvent(id, 'dismissed')).toThrow(/reason is required/)
    const dismissed = services.transitionEvent(id, 'dismissed', 'Raised in error')
    expect(dismissed.dismissal).toMatchObject({ reason: 'Raised in error', dismissedByUserId: FIXTURE_IDS.users.thandi })
    expect(auditFor(id).at(-1)?.action).toBe('dismiss')
    expect(() => services.transitionEvent(id, 'under_review')).toThrow()
  })

  it('assigns events and counts open events by type', () => {
    expect(services.assignEvent(id, FIXTURE_IDS.users.sipho).assignedToUserId).toBe(FIXTURE_IDS.users.sipho)
    const counts = services.countOpenEventsByType(services.listAllEvents())
    expect(counts.rental_escalation_discrepancy).toBe(1)
    expect(counts.arrears).toBe(0)
  })
})

describe('arrangements', () => {
  it('creates an arrangement with a generated schedule and closes it when all instalments are confirmed', () => {
    const arrangement = services.createArrangement({
      tenantId: FIXTURE_IDS.tenants.pickNPay,
      leaseId: FIXTURE_IDS.leases.pickNPay,
      outstandingBalance: 61_000,
      installmentAmount: 25_000,
      frequency: 'monthly',
      firstInstallmentDate: '2026-12-01',
      notes: 'Agreed with store manager',
    })
    expect(arrangement.status).toBe('active')
    expect(arrangement.suppressArrearsReminders).toBe(true)
    expect(arrangement.installments.map((i) => i.amount)).toEqual([25_000, 25_000, 11_000])
    expect(arrangement.installments.map((i) => i.dueDate)).toEqual(['2026-12-01', '2027-01-01', '2027-02-01'])
    expect(arrangement.installments.every((i) => i.arrangementId === arrangement.id)).toBe(true)
    expect(arrangement.finalInstallmentDate).toBe('2027-02-01')
    expect(services.getActiveArrangementForTenant(FIXTURE_IDS.tenants.pickNPay)?.id).toBe(arrangement.id)

    expect(() =>
      services.createArrangement({
        tenantId: FIXTURE_IDS.tenants.pickNPay,
        leaseId: FIXTURE_IDS.leases.pickNPay,
        outstandingBalance: 1_000,
        installmentAmount: 500,
        frequency: 'weekly',
        firstInstallmentDate: '2026-12-01',
      }),
    ).toThrow(/already has an active arrangement/)

    const [first, second, third] = arrangement.installments
    services.markInstallmentMissed(arrangement.id, first.id, 'No payment on statement')
    expect(services.getArrangement(arrangement.id)?.installments[0].status).toBe('missed')
    services.confirmInstallment(arrangement.id, first.id, '2026-12-03')
    services.confirmInstallment(arrangement.id, second.id)
    const done = services.confirmInstallment(arrangement.id, third.id)
    expect(done.status).toBe('completed')
    expect(done.suppressArrearsReminders).toBe(false)
    expect(done.closedOn).toBeDefined()
    expect(() => services.closeArrangement(arrangement.id, 'cancelled')).toThrow(/already completed/)
  })

  it('refuses a lease that does not belong to the tenant', () => {
    expect(() =>
      services.createArrangement({
        tenantId: FIXTURE_IDS.tenants.pickNPay,
        leaseId: FIXTURE_IDS.leases.coastalLaw,
        outstandingBalance: 100,
        installmentAmount: 50,
        frequency: 'weekly',
        firstInstallmentDate: '2026-12-01',
      }),
    ).toThrow()
  })
})

describe('communications', () => {
  const tenantId = FIXTURE_IDS.tenants.pickNPay

  it('rejects non-tenant message types', () => {
    for (const forbidden of ['owner_weekly_summary', 'lease_expiry_notice', 'manual', 'inbound_reply']) {
      expect(() => services.draftTenantMessage(forbidden as TenantMessageType, tenantId, 'hi')).toThrow(
        services.ForbiddenTenantMessageError,
      )
    }
    expect(services.communicationsRepo.count()).toBe(0)
  })

  it('creates a pending approval when the company requires approval, then approves', () => {
    const { communication, approval } = services.draftTenantMessage('monthly_statement', tenantId, 'Your statement is attached.', {
      statementId: FIXTURE_IDS.statements.pickNPayOct,
    })
    expect(communication.status).toBe('pending_approval')
    expect(communication.recipientType).toBe('tenant')
    expect(communication.counterpartyNumber).toBe('+27831230001')
    expect(approval?.decision).toBe('pending')
    expect(communication.approvalId).toBe(approval?.id)
    expect(services.listPendingApprovals()).toHaveLength(1)

    const approved = services.approveMessage(communication.id)
    expect(approved.status).toBe('queued')
    expect(services.getApproval(approval?.id ?? '')?.decision).toBe('approved')
    expect(auditFor(communication.id).some((l) => l.action === 'approve')).toBe(true)
    expect(() => services.approveMessage(communication.id)).toThrow(/already approved/)

    const sent = services.recordDeliveryStatus(communication.id, 'sent', { externalMessageId: 'wamid.1' })
    expect(sent.sentAt).toBeDefined()
    const read = services.recordDeliveryStatus(communication.id, 'read')
    expect(read.readAt).toBeDefined()
    expect(read.deliveredAt).toBeDefined()
  })

  it('rejects messages with a reason and blocks delivery updates on rejected messages', () => {
    const { communication } = services.draftTenantMessage('overdue_payment_reminder', tenantId, 'Reminder')
    expect(() => services.rejectMessage(communication.id, '  ')).toThrow(/reason/)
    expect(services.rejectMessage(communication.id, 'Tone too harsh').status).toBe('rejected')
    expect(() => services.recordDeliveryStatus(communication.id, 'sent')).toThrow(/rejected/)
    expect(() => services.recordDeliveryStatus(communication.id, 'sent')).toThrow()
  })

  it('skips approval when the company does not require it', () => {
    services.updateSettings({ requireApprovalForTenantMessages: false })
    const { communication, approval } = services.draftTenantMessage('initial_payment_reminder', tenantId, 'Reminder')
    expect(communication.status).toBe('approved')
    expect(approval).toBeUndefined()
  })

  it('refuses tenants who opted out', () => {
    services.setOptOut(tenantId, true)
    expect(() => services.draftTenantMessage('monthly_statement', tenantId, 'Hi')).toThrow(/opted out/)
  })

  it('records inbound replies and orders the conversation by time', () => {
    const { communication } = services.draftTenantMessage('monthly_statement', tenantId, 'Statement')
    services.recordInboundReply({ tenantId, body: 'Thanks, received.', receivedAt: '2030-01-01T09:00:00+02:00' })
    services.recordInboundReply({ tenantId, body: 'Earlier message', receivedAt: '2026-01-01T09:00:00+02:00' })
    const convo = services.listConversation(tenantId)
    expect(convo.map((c) => c.body)).toEqual(['Earlier message', communication.body, 'Thanks, received.'])
    expect(convo[2]).toMatchObject({ direction: 'inbound', messageType: 'inbound_reply', status: 'received' })
  })
})

describe('notifications and audit', () => {
  it('lists, pushes and marks notifications for the current user without audit rows', () => {
    expect(services.listForCurrentUser()).toHaveLength(1)
    expect(services.getUnreadCount()).toBe(1)
    const auditCount = Object.keys(useAppStore.getState().collections.auditLogs).length
    const pushed = services.pushNotification({ type: 'system', title: 'Hello', body: 'World' })
    expect(pushed.userId).toBe(FIXTURE_IDS.users.thandi)
    expect(services.getUnreadCount()).toBe(2)
    expect(services.markRead(pushed.id)?.read).toBe(true)
    expect(services.markAllRead()).toBe(1)
    expect(services.getUnreadCount()).toBe(0)
    expect(Object.keys(useAppStore.getState().collections.auditLogs)).toHaveLength(auditCount)
    useAppStore.getState().switchWorkspace(atlas)
    expect(services.listForCurrentUser().map((n) => n.id)).toEqual([FIXTURE_IDS.notifications.sipho])
  })

  it('lists audit newest first, scoped to the company, and per entity', () => {
    services.updateUnit(FIXTURE_IDS.units.sowetoA2, { floor: '1' })
    services.updateUnit(FIXTURE_IDS.units.sowetoA2, { floor: '2' })
    const login = services.recordAudit({ action: 'login', entityType: 'user', entityId: FIXTURE_IDS.users.thandi, summary: 'Signed in' })
    // Timestamps have second resolution, so pin one row in the past to assert ordering.
    useAppStore.getState().patch('auditLogs', login.id, { occurredAt: '2026-01-01T00:00:00+02:00' })
    const all = services.listAudit()
    expect(all.total).toBe(3)
    expect(all.items.at(-1)?.action).toBe('login')
    expect(services.listAudit({ sort: { field: 'occurredAt', direction: 'asc' } }).items[0].action).toBe('login')
    expect(services.listAuditForEntity('unit', FIXTURE_IDS.units.sowetoA2)).toHaveLength(2)
    expect(services.listAudit({ filters: { action: ['update'] } }).total).toBe(2)
    useAppStore.getState().switchWorkspace(atlas)
    expect(services.listAudit().total).toBe(0)
  })
})

describe('hooks', () => {
  it('useList/useById react to store changes and workspace switches', () => {
    const list = renderHook(() => services.useUnits({ sort: { field: 'unitNumber', direction: 'asc' } }))
    expect(list.result.current.items.map((u) => u.unitNumber)).toEqual(['A1', 'A2'])
    const first = list.result.current

    list.rerender()
    expect(list.result.current).toBe(first)

    services.createUnit({ propertyId: FIXTURE_IDS.properties.soweto, unitNumber: 'A0', type: 'kiosk', floorAreaSqm: 10, occupancyStatus: 'vacant' })
    list.rerender()
    expect(list.result.current.items.map((u) => u.unitNumber)).toEqual(['A0', 'A1', 'A2'])

    useAppStore.getState().switchWorkspace(atlas)
    list.rerender()
    expect(list.result.current.items.map((u) => u.unitNumber)).toEqual(['B1'])

    const byId = renderHook(() => services.useUnit(FIXTURE_IDS.units.sowetoA1))
    expect(byId.result.current).toBeUndefined()
  })

  it('aggregate hooks compute derived views', () => {
    const stats = renderHook(() => services.usePropertyWithStats(FIXTURE_IDS.properties.soweto))
    expect(stats.result.current?.stats).toMatchObject({ unitCount: 2, occupiedCount: 1, vacantCount: 1, occupancyRate: 0.5, activeLeaseCount: 1, monthlyRentalRoll: 408_240 })

    const summary = renderHook(() => services.useTenantSummary(FIXTURE_IDS.tenants.pickNPay))
    expect(summary.result.current?.activeLease?.reference).toBe('MSQ-L001')
    expect(summary.result.current?.openEventCount).toBe(1)
    expect(summary.result.current?.canMessage).toBe(true)

    const counts = renderHook(() => services.useOpenEventCounts())
    expect(counts.result.current.rental_escalation_discrepancy).toBe(1)

    const unread = renderHook(() => services.useUnreadCount())
    expect(unread.result.current).toBe(1)

    const permissions = renderHook(() => services.usePermissions())
    expect(permissions.result.current.verifyLeases).toBe(true)

    const audit = renderHook(() => services.useAuditForEntity('unit', FIXTURE_IDS.units.sowetoA2))
    expect(audit.result.current).toEqual([])
  })
})

describe('resetDemoData', () => {
  it('restores the mocked seed and the default workspace', () => {
    services.removeUnit(FIXTURE_IDS.units.sowetoA2)
    useAppStore.getState().switchWorkspace(atlas)
    useAppStore.getState().resetDemoData()
    expect(useAppStore.getState().collections).toEqual(createFixtureCollections())
    expect(useAppStore.getState().workspace).toEqual(FIXTURE_WORKSPACE)
    expect(services.listAllUnits()).toHaveLength(2)
  })
})
