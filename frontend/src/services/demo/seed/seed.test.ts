import { addMonths, format } from 'date-fns'
import { describe, expect, it } from 'vitest'

import type { CollectionKey, Collections } from '@/store/collections'
import { COLLECTION_KEYS } from '@/store/collections'
import type { EntityId, EntityType, InstallmentFrequency, ISODate, Lease, Statement } from '@leaseguard/domain'
import { TENANT_MESSAGE_TYPES } from '@leaseguard/domain'

import { DEMO_COMPANY_IDS, DEMO_DEFAULT_USER_ID, DEMO_REFERENCE_DATE, createDemoSeed } from './index'

const seed = createDemoSeed()
const NEXUS = DEMO_COMPANY_IDS.nexus
const SECOND = DEMO_COMPANY_IDS.second

const all = <K extends CollectionKey>(key: K): Collections[K][EntityId][] => Object.values(seed[key])
const ofCompany = <K extends Exclude<CollectionKey, 'companies' | 'users'>>(key: K, companyId: EntityId) =>
  all(key).filter((r) => r.companyId === companyId)

const ENTITY_COLLECTION: Record<EntityType, CollectionKey> = {
  company: 'companies',
  user: 'users',
  property: 'properties',
  unit: 'units',
  tenant: 'tenants',
  lease: 'leases',
  lease_document: 'leaseDocuments',
  statement: 'statements',
  statement_extraction: 'statementExtractions',
  monitoring_event: 'monitoringEvents',
  monitoring_rule: 'monitoringRules',
  payment_arrangement: 'paymentArrangements',
  communication: 'communications',
  message_template: 'messageTemplates',
  message_approval: 'messageApprovals',
  notification: 'notifications',
  audit_log: 'auditLogs',
}

/** Assert `id` (when defined) points at a record in `key` owned by `companyId`. */
function expectFk(
  key: Exclude<CollectionKey, 'companies' | 'users'>,
  id: EntityId | undefined,
  companyId: EntityId,
  context: string,
): void {
  if (id === undefined) return
  const target = seed[key][id]
  expect(target, `${context}: ${key} ${id} missing`).toBeDefined()
  expect(target?.companyId, `${context}: ${key} ${id} belongs to another company`).toBe(companyId)
}

/** Users are global: the user must exist and have a membership in `companyId`. */
function expectUser(id: EntityId | undefined, companyId: EntityId, context: string): void {
  if (id === undefined) return
  const user = seed.users[id]
  expect(user, `${context}: user ${id} missing`).toBeDefined()
  expect(
    user?.memberships.some((m) => m.companyId === companyId),
    `${context}: user ${id} has no membership in ${companyId}`,
  ).toBe(true)
}

const isLive = (lease: Lease): boolean => lease.status === 'active' || lease.status === 'expiring'

const sum = (values: readonly number[]): number => Math.round(values.reduce((a, b) => a + b, 0) * 100) / 100

function plainAddMonths(iso: ISODate, months: number): ISODate {
  const [y, m, d] = iso.split('-').map(Number)
  return format(addMonths(new Date(y, m - 1, d), months), 'yyyy-MM-dd')
}

/** Plain-arithmetic re-derivation of the current rental, independent of src/domain. */
function recomputeCurrentRental(lease: Lease, asOf: ISODate): number {
  const { escalation, initialMonthlyRental } = lease
  if (escalation.type === 'none') return initialMonthlyRental
  const interval = escalation.frequency === 'biennial' ? 24 : 12
  const upper = asOf < lease.expiryDate ? asOf : lease.expiryDate
  let count = 0
  for (let k = 0; k < 1000; k++) {
    const date = plainAddMonths(escalation.firstEscalationDate, k * interval)
    if (date > upper) break
    count += 1
  }
  let rental: number
  switch (escalation.type) {
    case 'percentage':
      rental = initialMonthlyRental * Math.pow(1 + (escalation.percentage ?? 0) / 100, count)
      break
    case 'cpi_linked':
      rental =
        initialMonthlyRental *
        Math.pow(1 + ((escalation.cpiAssumedPercentage ?? 0) + (escalation.cpiMarginPercentage ?? 0)) / 100, count)
      break
    case 'fixed_amount':
      rental = initialMonthlyRental + (escalation.fixedAmount ?? 0) * count
      break
  }
  return Math.round(rental * 100) / 100
}

function expectedDueDate(first: ISODate, frequency: InstallmentFrequency, sequence: number): ISODate {
  const [y, m, d] = first.split('-').map(Number)
  const base = new Date(y, m - 1, d)
  if (frequency === 'monthly') return format(addMonths(base, sequence - 1), 'yyyy-MM-dd')
  const step = frequency === 'weekly' ? 7 : 14
  const date = new Date(base)
  date.setDate(date.getDate() + step * (sequence - 1))
  return format(date, 'yyyy-MM-dd')
}

describe('demo seed public API', () => {
  it('exposes the documented constants', () => {
    expect(DEMO_REFERENCE_DATE).toBe('2026-11-06')
    expect(DEMO_COMPANY_IDS.nexus).toBe('cmp_nexus')
    expect(DEMO_COMPANY_IDS.second).toMatch(/^cmp_[a-z0-9_]+$/)
    expect(DEMO_COMPANY_IDS.second).not.toBe(DEMO_COMPANY_IDS.nexus)
    expect(seed.companies[NEXUS]).toBeDefined()
    expect(seed.companies[SECOND]).toBeDefined()
  })

  it('returns a fresh deep copy on every call', () => {
    const a = createDemoSeed()
    const b = createDemoSeed()
    expect(a).not.toBe(b)
    expect(a).toEqual(b)
    for (const key of COLLECTION_KEYS) {
      expect(a[key], key).not.toBe(b[key])
      for (const id of Object.keys(a[key])) expect(a[key][id], `${key}.${id}`).not.toBe(b[key][id])
    }
    // Mutating one copy (through a mutable view) must not leak into another.
    const mutable = a as unknown as { leases: Record<string, { reference: string }> }
    const leaseId = Object.keys(a.leases)[0]
    try {
      mutable.leases[leaseId].reference = 'MUTATED'
    } catch {
      // Frozen in DEV mode: mutation is refused, which is equally isolating.
    }
    expect(b.leases[leaseId].reference).not.toBe('MUTATED')
    expect(createDemoSeed().leases[leaseId].reference).not.toBe('MUTATED')
  })

  it('has no duplicate ids across all collections', () => {
    const seen = new Map<EntityId, CollectionKey>()
    for (const key of COLLECTION_KEYS) {
      for (const [id, record] of Object.entries(seed[key])) {
        expect(record.id, `${key}.${id} key/id mismatch`).toBe(id)
        expect(seen.has(id), `id ${id} appears in both ${seen.get(id)} and ${key}`).toBe(false)
        seen.set(id, key)
      }
    }
  })

  it('DEMO_DEFAULT_USER_ID is an active Nexus property manager', () => {
    const user = seed.users[DEMO_DEFAULT_USER_ID]
    expect(user).toBeDefined()
    expect(user.status).toBe('active')
    expect(user.memberships.find((m) => m.companyId === NEXUS)?.role).toBe('property_manager')
  })

  it('one user has memberships in both companies', () => {
    const shared = all('users').filter(
      (u) => u.memberships.some((m) => m.companyId === NEXUS) && u.memberships.some((m) => m.companyId === SECOND),
    )
    expect(shared.length).toBeGreaterThanOrEqual(1)
  })
})

describe('demo seed volume', () => {
  it('covers Nexus with enough records for the demo', () => {
    expect(ofCompany('properties', NEXUS).length).toBeGreaterThanOrEqual(3)
    expect(ofCompany('units', NEXUS).length).toBeGreaterThanOrEqual(20)
    expect(ofCompany('tenants', NEXUS).length).toBeGreaterThanOrEqual(12)
    expect(ofCompany('leases', NEXUS).length).toBeGreaterThanOrEqual(12)
    expect(ofCompany('statements', NEXUS).length).toBeGreaterThanOrEqual(8)
    expect(ofCompany('monitoringEvents', NEXUS).length).toBeGreaterThanOrEqual(10)
    expect(ofCompany('paymentArrangements', NEXUS).length).toBeGreaterThanOrEqual(4)
    expect(ofCompany('communications', NEXUS).length).toBeGreaterThanOrEqual(8)
    const roles = new Set(
      all('users').flatMap((u) => u.memberships.filter((m) => m.companyId === NEXUS).map((m) => m.role)),
    )
    expect(roles.size).toBeGreaterThanOrEqual(3)
  })

  it('gives the second company records in every core collection', () => {
    const core = [
      'properties',
      'units',
      'tenants',
      'leases',
      'statements',
      'monitoringEvents',
      'monitoringRules',
      'paymentArrangements',
      'communications',
      'messageTemplates',
      'notifications',
    ] as const
    for (const key of core) expect(ofCompany(key, SECOND).length, key).toBeGreaterThanOrEqual(1)
    expect(all('users').some((u) => u.memberships.some((m) => m.companyId === SECOND))).toBe(true)
  })
})

describe('demo seed referential integrity', () => {
  it('memberships reference existing companies', () => {
    for (const user of all('users')) {
      expect(user.memberships.length, user.id).toBeGreaterThan(0)
      for (const m of user.memberships) expect(seed.companies[m.companyId], `${user.id} -> ${m.companyId}`).toBeDefined()
    }
  })

  it('every companyId resolves to a company', () => {
    for (const key of COLLECTION_KEYS) {
      if (key === 'companies' || key === 'users') continue
      for (const record of all(key)) {
        expect(seed.companies[record.companyId], `${key}.${record.id}`).toBeDefined()
      }
    }
  })

  it('properties, units, tenants and leases link consistently', () => {
    for (const p of all('properties')) {
      expectUser(p.managerUserId, p.companyId, `property ${p.id} manager`)
      expectUser(p.ownerUserId, p.companyId, `property ${p.id} owner`)
    }
    for (const u of all('units')) {
      expectFk('properties', u.propertyId, u.companyId, `unit ${u.id}`)
      expectFk('tenants', u.currentTenantId, u.companyId, `unit ${u.id}`)
      expectFk('leases', u.currentLeaseId, u.companyId, `unit ${u.id}`)
    }
    for (const l of all('leases')) {
      expectFk('properties', l.propertyId, l.companyId, `lease ${l.id}`)
      expectFk('units', l.unitId, l.companyId, `lease ${l.id}`)
      expectFk('tenants', l.tenantId, l.companyId, `lease ${l.id}`)
      expectFk('leases', l.previousLeaseId, l.companyId, `lease ${l.id}`)
      expectUser(l.verifiedByUserId, l.companyId, `lease ${l.id} verifier`)
      expect(seed.units[l.unitId].propertyId, `lease ${l.id} unit/property`).toBe(l.propertyId)
      expect(seed.tenants[l.tenantId].companyId, `lease ${l.id} tenant company`).toBe(l.companyId)
      if (l.verified) expect(l.verifiedByUserId, `lease ${l.id} verified without verifier`).toBeDefined()
    }
    for (const d of all('leaseDocuments')) {
      expectFk('leases', d.leaseId, d.companyId, `document ${d.id}`)
      expectUser(d.uploadedByUserId, d.companyId, `document ${d.id}`)
    }
  })

  it('statements and extractions link consistently', () => {
    for (const s of all('statements')) {
      expectFk('properties', s.propertyId, s.companyId, `statement ${s.id}`)
      expectFk('tenants', s.tenantId, s.companyId, `statement ${s.id}`)
      expectFk('units', s.unitId, s.companyId, `statement ${s.id}`)
      expectFk('leases', s.leaseId, s.companyId, `statement ${s.id}`)
      expectFk('statementExtractions', s.extractionId, s.companyId, `statement ${s.id}`)
      expectFk('statements', s.duplicateOfStatementId, s.companyId, `statement ${s.id}`)
      expectFk('communications', s.deliveredCommunicationId, s.companyId, `statement ${s.id}`)
      expectUser(s.uploadedByUserId, s.companyId, `statement ${s.id} uploader`)
      expectUser(s.verifiedByUserId, s.companyId, `statement ${s.id} verifier`)
      if (s.extractionId) expect(seed.statementExtractions[s.extractionId].statementId).toBe(s.id)
      if (s.leaseId) {
        const lease = seed.leases[s.leaseId]
        if (s.tenantId) expect(lease.tenantId, `statement ${s.id} lease/tenant`).toBe(s.tenantId)
        if (s.unitId) expect(lease.unitId, `statement ${s.id} lease/unit`).toBe(s.unitId)
      }
      if (s.status === 'duplicate') expect(s.duplicateOfStatementId, `duplicate ${s.id} without original`).toBeDefined()
      for (const li of s.lineItems) expect(li.statementId, `line ${li.id}`).toBe(s.id)
    }
    for (const e of all('statementExtractions')) {
      expectFk('statements', e.statementId, e.companyId, `extraction ${e.id}`)
      expectFk('tenants', e.matchedTenantId, e.companyId, `extraction ${e.id}`)
      expectFk('units', e.matchedUnitId, e.companyId, `extraction ${e.id}`)
      expectUser(e.reviewedByUserId, e.companyId, `extraction ${e.id} reviewer`)
      for (const f of e.fields) expectUser(f.correctedByUserId, e.companyId, `extraction ${e.id} field ${f.name}`)
    }
  })

  it('monitoring events and rules link consistently', () => {
    for (const r of all('monitoringRules')) {
      expectUser(r.defaultAssigneeUserId, r.companyId, `rule ${r.id}`)
      expect(r.config.kind, `rule ${r.id} config kind`).toBe(r.eventType)
    }
    for (const e of all('monitoringEvents')) {
      expectFk('properties', e.propertyId, e.companyId, `event ${e.id}`)
      expectFk('units', e.unitId, e.companyId, `event ${e.id}`)
      expectFk('tenants', e.tenantId, e.companyId, `event ${e.id}`)
      expectFk('leases', e.leaseId, e.companyId, `event ${e.id}`)
      expectFk('statements', e.statementId, e.companyId, `event ${e.id}`)
      expectFk('paymentArrangements', e.arrangementId, e.companyId, `event ${e.id}`)
      expectFk('monitoringRules', e.ruleId, e.companyId, `event ${e.id}`)
      expectUser(e.assignedToUserId, e.companyId, `event ${e.id} assignee`)
      expectUser(e.resolvedByUserId, e.companyId, `event ${e.id} resolver`)
      if (e.ruleId) expect(seed.monitoringRules[e.ruleId].eventType, `event ${e.id} rule type`).toBe(e.type)
      if (e.leaseId) {
        expect(seed.leases[e.leaseId].reference, `event ${e.id} leaseReference`).toBe(e.leaseReference)
        expect(seed.leases[e.leaseId].propertyId, `event ${e.id} lease/property`).toBe(e.propertyId)
      }
      if (e.status === 'dismissed') {
        expect(e.dismissal, `dismissed event ${e.id} without dismissal`).toBeDefined()
        expectUser(e.dismissal?.dismissedByUserId, e.companyId, `event ${e.id} dismisser`)
      } else {
        expect(e.dismissal, `event ${e.id} carries a dismissal but is ${e.status}`).toBeUndefined()
      }
      if (e.status === 'resolved') expect(e.resolvedAt, `resolved event ${e.id} without resolvedAt`).toBeDefined()
    }
  })

  it('payment arrangements link consistently', () => {
    for (const a of all('paymentArrangements')) {
      expectFk('tenants', a.tenantId, a.companyId, `arrangement ${a.id}`)
      expectFk('properties', a.propertyId, a.companyId, `arrangement ${a.id}`)
      expectFk('units', a.unitId, a.companyId, `arrangement ${a.id}`)
      expectFk('leases', a.leaseId, a.companyId, `arrangement ${a.id}`)
      expectUser(a.agreedByUserId, a.companyId, `arrangement ${a.id}`)
      const lease = seed.leases[a.leaseId]
      expect(lease.tenantId, `arrangement ${a.id} lease/tenant`).toBe(a.tenantId)
      expect(lease.unitId, `arrangement ${a.id} lease/unit`).toBe(a.unitId)
      expect(lease.propertyId, `arrangement ${a.id} lease/property`).toBe(a.propertyId)
      for (const i of a.installments) {
        expect(i.arrangementId, `instalment ${i.id}`).toBe(a.id)
        expectUser(i.confirmedByUserId, a.companyId, `instalment ${i.id}`)
      }
    }
  })

  it('communications, templates and approvals link consistently', () => {
    for (const c of all('communications')) {
      expectFk('tenants', c.tenantId, c.companyId, `communication ${c.id}`)
      expectFk('properties', c.propertyId, c.companyId, `communication ${c.id}`)
      expectFk('leases', c.leaseId, c.companyId, `communication ${c.id}`)
      expectFk('statements', c.statementId, c.companyId, `communication ${c.id}`)
      expectFk('paymentArrangements', c.arrangementId, c.companyId, `communication ${c.id}`)
      expectFk('messageTemplates', c.templateId, c.companyId, `communication ${c.id}`)
      expectFk('messageApprovals', c.approvalId, c.companyId, `communication ${c.id}`)
      expectUser(c.ownerUserId, c.companyId, `communication ${c.id} owner`)
      expectUser(c.createdByUserId, c.companyId, `communication ${c.id} creator`)
      if (c.approvalId) expect(seed.messageApprovals[c.approvalId].communicationId).toBe(c.id)
      if (c.templateId) expect(seed.messageTemplates[c.templateId].messageType, `communication ${c.id} template type`).toBe(c.messageType)
      if (c.recipientType === 'tenant') {
        expect(c.tenantId, `tenant communication ${c.id} without tenantId`).toBeDefined()
        expect(c.ownerUserId, `tenant communication ${c.id} with ownerUserId`).toBeUndefined()
      } else {
        expect(c.ownerUserId, `owner communication ${c.id} without ownerUserId`).toBeDefined()
      }
      expect(c.companyNumber, `communication ${c.id} companyNumber`).toBe(seed.companies[c.companyId].whatsapp.displayNumber)
    }
    for (const a of all('messageApprovals')) {
      expectFk('communications', a.communicationId, a.companyId, `approval ${a.id}`)
      expectUser(a.requestedByUserId, a.companyId, `approval ${a.id} requester`)
      expectUser(a.decidedByUserId, a.companyId, `approval ${a.id} decider`)
      expect(seed.communications[a.communicationId].approvalId, `approval ${a.id} back-link`).toBe(a.id)
      if (a.decision !== 'pending') expect(a.decidedByUserId, `approval ${a.id} decided without decider`).toBeDefined()
    }
  })

  it('notifications and audit logs link consistently', () => {
    for (const n of all('notifications')) {
      expectUser(n.userId, n.companyId, `notification ${n.id}`)
      if (n.link) {
        const key = ENTITY_COLLECTION[n.link.entityType]
        const target = seed[key][n.link.entityId]
        expect(target, `notification ${n.id} -> ${key} ${n.link.entityId}`).toBeDefined()
        if (key !== 'companies' && key !== 'users') {
          expect((target as { companyId: EntityId }).companyId, `notification ${n.id} link company`).toBe(n.companyId)
        }
      }
    }
    for (const a of all('auditLogs')) {
      expectUser(a.actorUserId, a.companyId, `audit ${a.id}`)
      const key = ENTITY_COLLECTION[a.entityType]
      // Deleted records are legitimately absent, but anything present must belong to the same company.
      const target = seed[key][a.entityId]
      if (target && key !== 'companies' && key !== 'users') {
        expect((target as { companyId: EntityId }).companyId, `audit ${a.id} entity company`).toBe(a.companyId)
      }
    }
  })
})

describe('demo seed business invariants', () => {
  it('units agree with their live lease', () => {
    for (const unit of all('units')) {
      const live = all('leases').filter((l) => l.unitId === unit.id && isLive(l))
      expect(live.length, `unit ${unit.id} has ${live.length} live leases`).toBeLessThanOrEqual(1)
      const lease = live[0]
      if (lease) {
        expect(unit.occupancyStatus, `unit ${unit.id} occupancy`).toBe('occupied')
        expect(unit.currentLeaseId, `unit ${unit.id} currentLeaseId`).toBe(lease.id)
        expect(unit.currentTenantId, `unit ${unit.id} currentTenantId`).toBe(lease.tenantId)
      } else {
        expect(unit.occupancyStatus, `unit ${unit.id} occupancy`).not.toBe('occupied')
        // Without a live lease the pointers may only reference a signed-but-unverified lease on
        // this very unit (an `under_offer` unit); anything else is a stale denormalisation.
        if (unit.currentLeaseId !== undefined) {
          const pending = seed.leases[unit.currentLeaseId]
          expect(pending.unitId, `unit ${unit.id} currentLeaseId points elsewhere`).toBe(unit.id)
          expect(['pending_verification', 'draft'], `unit ${unit.id} stale currentLeaseId`).toContain(pending.status)
          expect(unit.occupancyStatus, `unit ${unit.id} occupancy`).toBe('under_offer')
          expect(unit.currentTenantId, `unit ${unit.id} currentTenantId`).toBe(pending.tenantId)
        } else {
          expect(unit.currentTenantId, `unit ${unit.id} stale currentTenantId`).toBeUndefined()
        }
      }
    }
  })

  it('lease status agrees with the reference date and escalation dates are sane', () => {
    for (const lease of all('leases')) {
      expect(lease.commencementDate < lease.expiryDate, `lease ${lease.id} dates`).toBe(true)
      expect(lease.paymentDueDay).toBeGreaterThanOrEqual(1)
      expect(lease.paymentDueDay).toBeLessThanOrEqual(28)
      if (lease.escalation.type !== 'none') {
        expect(lease.escalation.firstEscalationDate > lease.commencementDate, `lease ${lease.id} firstEscalationDate`).toBe(true)
      }
      if (lease.status === 'expired') expect(lease.expiryDate < DEMO_REFERENCE_DATE, `lease ${lease.id} expired early`).toBe(true)
      if (isLive(lease)) expect(lease.expiryDate >= DEMO_REFERENCE_DATE, `lease ${lease.id} live but past expiry`).toBe(true)
      if (isLive(lease) || lease.status === 'expired' || lease.status === 'renewed') {
        expect(lease.verified, `lease ${lease.id} ${lease.status} but unverified`).toBe(true)
      }
      if (lease.status === 'pending_verification' || lease.status === 'draft') expect(lease.verified).toBe(false)
    }
  })

  it('currentMonthlyRental equals the compounded escalations as of the reference date', () => {
    for (const lease of all('leases')) {
      const expected = recomputeCurrentRental(lease, DEMO_REFERENCE_DATE)
      expect(Math.abs(lease.currentMonthlyRental - expected), `lease ${lease.reference}: ${lease.currentMonthlyRental} vs ${expected}`).toBeLessThanOrEqual(0.01)
    }
  })

  it('statement figures reconcile with their line items', () => {
    const withFigures = all('statements').filter((s) => s.closingBalance !== undefined)
    expect(withFigures.length).toBeGreaterThan(0)
    for (const s of withFigures) {
      const charges = s.lineItems.filter((li) => li.kind === 'charge')
      const payments = s.lineItems.filter((li) => li.kind === 'payment')
      const credits = s.lineItems.filter((li) => li.kind === 'credit')
      for (const li of s.lineItems) {
        expect(li.amount, `line ${li.id} amount must be positive`).toBeGreaterThan(0)
        if (li.kind === 'payment') expect(li.category).toBe('payment')
        if (li.kind === 'credit') expect(li.category).toBe('credit')
        if (li.kind === 'charge') expect(['payment', 'credit']).not.toContain(li.category)
      }
      const rental = sum(charges.filter((li) => li.category === 'rental').map((li) => li.amount))
      const additional = sum(charges.filter((li) => li.category !== 'rental').map((li) => li.amount))
      const paid = sum(payments.map((li) => li.amount))
      const credited = sum(credits.map((li) => li.amount))
      const opening = s.openingBalance ?? 0
      const closing = Math.round((opening + rental + additional - paid - credited) * 100) / 100
      expect(Math.abs((s.closingBalance as number) - closing), `statement ${s.id} closing ${s.closingBalance} vs ${closing}`).toBeLessThanOrEqual(0.01)
      if (s.rentalCharged !== undefined) expect(Math.abs(s.rentalCharged - rental), `statement ${s.id} rentalCharged`).toBeLessThanOrEqual(0.01)
      if (s.additionalCharges !== undefined) expect(Math.abs(s.additionalCharges - additional), `statement ${s.id} additionalCharges`).toBeLessThanOrEqual(0.01)
      if (s.paymentsReceived !== undefined) expect(Math.abs(s.paymentsReceived - paid), `statement ${s.id} paymentsReceived`).toBeLessThanOrEqual(0.01)
      if (s.totalDue !== undefined) expect(Math.abs(s.totalDue - (s.closingBalance as number)), `statement ${s.id} totalDue`).toBeLessThanOrEqual(0.01)
      expect(s.periodStart <= s.periodEnd, `statement ${s.id} period`).toBe(true)
      for (const li of s.lineItems) {
        expect(li.date >= s.periodStart && li.date <= s.periodEnd, `line ${li.id} outside period`).toBe(true)
      }
    }
  })

  it('verified statements carry figures, a verifier and a matched tenant', () => {
    const verified: Statement[] = all('statements').filter((s) => s.status === 'verified')
    expect(verified.length).toBeGreaterThan(0)
    for (const s of verified) {
      expect(s.closingBalance, `verified ${s.id} without closingBalance`).toBeDefined()
      expect(s.verifiedByUserId, `verified ${s.id} without verifier`).toBeDefined()
      expect(s.tenantId, `verified ${s.id} without tenant`).toBeDefined()
    }
  })

  it('tenant communications use permitted message types only and are approved before sending', () => {
    const allowed: readonly string[] = [...TENANT_MESSAGE_TYPES, 'inbound_reply']
    for (const c of all('communications')) {
      if (c.recipientType !== 'tenant') {
        expect(c.messageType, `owner communication ${c.id}`).not.toBe('inbound_reply')
        continue
      }
      expect(allowed, `communication ${c.id} type ${c.messageType}`).toContain(c.messageType)
      if (c.direction === 'inbound') {
        expect(c.messageType).toBe('inbound_reply')
        expect(c.status).toBe('received')
        continue
      }
      expect(c.messageType).not.toBe('inbound_reply')
      const company = seed.companies[c.companyId]
      if (c.status === 'pending_approval') {
        expect(c.approvalId, `pending ${c.id} without approval`).toBeDefined()
        expect(seed.messageApprovals[c.approvalId as EntityId].decision).toBe('pending')
      }
      if (c.status === 'rejected') {
        expect(c.approvalId, `rejected ${c.id} without approval`).toBeDefined()
        expect(seed.messageApprovals[c.approvalId as EntityId].decision).toBe('rejected')
      }
      const dispatched = ['queued', 'sent', 'delivered', 'read', 'failed'].includes(c.status)
      if (dispatched && company.settings.requireApprovalForTenantMessages) {
        expect(c.approvalId, `dispatched ${c.id} without approval`).toBeDefined()
        expect(seed.messageApprovals[c.approvalId as EntityId].decision, `dispatched ${c.id} approval`).toBe('approved')
      }
      if (['sent', 'delivered', 'read'].includes(c.status)) expect(c.sentAt, `${c.id} sentAt`).toBeDefined()
      if (['delivered', 'read'].includes(c.status)) expect(c.deliveredAt, `${c.id} deliveredAt`).toBeDefined()
      if (c.status === 'read') expect(c.readAt, `${c.id} readAt`).toBeDefined()
      if (c.status === 'failed') expect(c.failureReason, `${c.id} failureReason`).toBeDefined()
      expect(c.counterpartyNumber, `${c.id} counterparty`).toBe(seed.tenants[c.tenantId as EntityId].whatsappNumber)
    }
  })

  it('message templates for tenants only use tenant message types', () => {
    for (const t of all('messageTemplates')) {
      if (t.audience === 'tenant') expect(TENANT_MESSAGE_TYPES as readonly string[], `template ${t.id}`).toContain(t.messageType)
      else expect(TENANT_MESSAGE_TYPES as readonly string[], `template ${t.id}`).not.toContain(t.messageType)
    }
  })

  it('payment arrangements have consistent schedules', () => {
    const active = all('paymentArrangements').filter((a) => a.status === 'active')
    expect(active.length).toBeGreaterThanOrEqual(2)
    for (const a of all('paymentArrangements')) {
      expect(a.installments.length, `arrangement ${a.id} empty schedule`).toBeGreaterThan(0)
      expect(a.installmentAmount).toBeGreaterThan(0)
      expect(a.outstandingBalance).toBeGreaterThan(0)
      if (a.status === 'active') {
        expect(a.suppressArrearsReminders, `active ${a.id} must suppress reminders`).toBe(true)
        expect(a.closedOn, `active ${a.id} has closedOn`).toBeUndefined()
        expect(a.agreedOn <= DEMO_REFERENCE_DATE, `active ${a.id} agreed in the future`).toBe(true)
      } else {
        expect(a.suppressArrearsReminders, `${a.status} ${a.id} must not suppress reminders`).toBe(false)
      }
      if (a.status === 'completed' || a.status === 'defaulted' || a.status === 'cancelled') {
        expect(a.closedOn, `${a.status} ${a.id} without closedOn`).toBeDefined()
      }
      if (a.status === 'completed') {
        expect(a.installments.every((i) => i.status === 'confirmed_paid' || i.status === 'waived'), `completed ${a.id} open instalments`).toBe(true)
      }
      const sorted = [...a.installments].sort((x, y) => x.sequence - y.sequence)
      sorted.forEach((inst, index) => {
        expect(inst.sequence, `arrangement ${a.id} sequence`).toBe(index + 1)
        expect(inst.dueDate, `arrangement ${a.id} instalment ${inst.sequence} dueDate`).toBe(
          expectedDueDate(a.firstInstallmentDate, a.frequency, inst.sequence),
        )
        expect(inst.amount, `instalment ${inst.id} amount`).toBeGreaterThan(0)
        if (index < sorted.length - 1) expect(inst.amount, `instalment ${inst.id} amount`).toBeCloseTo(a.installmentAmount, 2)
        else expect(inst.amount, `final instalment ${inst.id}`).toBeLessThanOrEqual(a.installmentAmount + 0.01)
        if (inst.status === 'confirmed_paid') expect(inst.confirmedByUserId, `instalment ${inst.id} confirmer`).toBeDefined()
        if (inst.status === 'reminder_sent') expect(inst.reminderSentAt, `instalment ${inst.id} reminderSentAt`).toBeDefined()
      })
      expect(sorted[0].dueDate).toBe(a.firstInstallmentDate)
      expect(sorted[sorted.length - 1].dueDate, `arrangement ${a.id} finalInstallmentDate`).toBe(a.finalInstallmentDate)
      expect(Math.abs(sum(sorted.map((i) => i.amount)) - a.outstandingBalance), `arrangement ${a.id} total`).toBeLessThanOrEqual(0.01)
    }
  })

  it('a tenant has at most one active arrangement', () => {
    const byTenant = new Map<EntityId, number>()
    for (const a of all('paymentArrangements')) {
      if (a.status !== 'active') continue
      byTenant.set(a.tenantId, (byTenant.get(a.tenantId) ?? 0) + 1)
    }
    for (const [tenantId, count] of byTenant) expect(count, `tenant ${tenantId} active arrangements`).toBe(1)
  })
})
