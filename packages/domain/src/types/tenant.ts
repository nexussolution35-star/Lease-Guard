import type { CompanyScoped, EntityId, ISODateTime } from './common.js'
import type { LeaseStatus } from './lease.js'

export const TENANT_STATUSES = ['active', 'in_arrears', 'notice_given', 'vacated', 'prospective'] as const
export type TenantStatus = (typeof TENANT_STATUSES)[number]

export const BUSINESS_TYPES = [
  'pty_ltd',
  'close_corporation',
  'sole_proprietor',
  'partnership',
  'npc',
  'franchise',
] as const
export type BusinessType = (typeof BUSINESS_TYPES)[number]

export interface TenantContact {
  fullName: string
  role: string
  phone: string
  email?: string
}

export interface Tenant extends CompanyScoped {
  legalName: string
  tradingName: string
  businessType: BusinessType
  registrationNumber?: string
  /** The tenant's account reference in the company's own system (tenant or debtor code); unique per company. */
  accountReference?: string
  vatNumber?: string
  primaryContact: TenantContact
  /** E.164 number used for WhatsApp, e.g. `+27821234567`. */
  whatsappNumber: string
  /** Numbers must be validated before automated communication is enabled. */
  whatsappVerified: boolean
  /** When a member validated the current number; absent while it is not validated (or validated before this was recorded). */
  whatsappValidatedAt?: ISODateTime
  /** Who validated the current number; absent for a background job or while it is not validated. */
  whatsappValidatedByUserId?: EntityId
  whatsappOptedOut: boolean
  email?: string
  status: TenantStatus
  industry: string
  notes?: string
}

/**
 * The lease a tenant list row shows, with its unit and property: the tenant's current lease
 * (see `currentLease`), or, when the list is filtered by property, its current lease in that property.
 */
export interface TenantLeaseSummary {
  leaseId: EntityId
  reference: string
  status: LeaseStatus
  verified: boolean
  unitId: EntityId
  unitNumber: string
  propertyId: EntityId
  propertyName: string
}

/** A row of the tenant list: the tenant, its current lease (absent when it has none) and its lease count. */
export interface TenantListItem extends Tenant {
  currentLease?: TenantLeaseSummary
  leaseCount: number
}
