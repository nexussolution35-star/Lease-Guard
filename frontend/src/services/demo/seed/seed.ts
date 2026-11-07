import type { EntityId, ISODate } from '@leaseguard/domain'
import type { Collections } from '@/store/collections'
import { toRecordMap } from '@/store/collections'
import { COMPANY_IDS, USER_IDS } from './ids'
import { companies } from './companies'
import { users } from './users'
import { properties } from './properties'
import { units } from './units'
import { tenants } from './tenants'
import { leases } from './leases'
import { leaseDocuments } from './leaseDocuments'
import { statementExtractions, statements } from './statements'
import { monitoringEvents, monitoringRules } from './monitoring'
import { paymentArrangements } from './arrangements'
import { communications, messageApprovals, messageTemplates } from './communications'
import { notifications } from './notifications'
import { auditLogs } from './auditLogs'

/** The "today" the demo data is authored against. */
export const DEMO_REFERENCE_DATE: ISODate = '2026-11-06'

export const DEMO_COMPANY_IDS = {
  nexus: COMPANY_IDS.nexus,
  second: COMPANY_IDS.kgalagadi,
} as const

/** Nexus property manager who is "logged in" when the demo starts. */
export const DEMO_DEFAULT_USER_ID: EntityId = USER_IDS.siphoPm

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

/**
 * Build the demo seed. Every call returns a fresh deep copy, so callers may hand the result to the
 * store without sharing references with the module-level arrays. In development the copy is deep
 * frozen so accidental mutation of seed data throws instead of silently corrupting later resets.
 */
export function createDemoSeed(): Collections {
  const collections: Collections = {
    companies: toRecordMap(companies),
    users: toRecordMap(users),
    properties: toRecordMap(properties),
    units: toRecordMap(units),
    tenants: toRecordMap(tenants),
    leases: toRecordMap(leases),
    leaseDocuments: toRecordMap(leaseDocuments),
    statements: toRecordMap(statements),
    statementExtractions: toRecordMap(statementExtractions),
    monitoringEvents: toRecordMap(monitoringEvents),
    monitoringRules: toRecordMap(monitoringRules),
    paymentArrangements: toRecordMap(paymentArrangements),
    communications: toRecordMap(communications),
    messageTemplates: toRecordMap(messageTemplates),
    messageApprovals: toRecordMap(messageApprovals),
    notifications: toRecordMap(notifications),
    auditLogs: toRecordMap(auditLogs),
  }
  const copy = structuredClone(collections)
  return import.meta.env.DEV ? deepFreeze(copy) : copy
}
