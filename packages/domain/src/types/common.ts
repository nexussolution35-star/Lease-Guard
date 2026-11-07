/** Shared primitives used across all LeaseGuard domain models. */

/** Opaque-ish identifier. Prefixed per entity in demo data, e.g. `cmp_nexus`, `lease_0001`. */
export type EntityId = string

/** Calendar date, `YYYY-MM-DD`, no time component. */
export type ISODate = string

/** Full timestamp, ISO 8601 with offset, e.g. `2026-11-06T08:30:00+02:00`. */
export type ISODateTime = string

/** Monetary amount in South African rand, stored as a decimal number of rands (2dp). */
export type ZAR = number

export const CURRENCY = 'ZAR' as const
export type Currency = typeof CURRENCY

export const SA_PROVINCES = [
  'Eastern Cape',
  'Free State',
  'Gauteng',
  'KwaZulu-Natal',
  'Limpopo',
  'Mpumalanga',
  'North West',
  'Northern Cape',
  'Western Cape',
] as const
export type SAProvince = (typeof SA_PROVINCES)[number]

export interface Address {
  line1: string
  line2?: string
  suburb: string
  city: string
  province: SAProvince
  postalCode: string
  country: 'South Africa'
}

export interface BaseEntity {
  id: EntityId
  createdAt: ISODateTime
  updatedAt: ISODateTime
}

/** Every company-owned record carries its company for workspace scoping. */
export interface CompanyScoped extends BaseEntity {
  companyId: EntityId
}

/** Reference to a stored file (lease PDF, statement PDF, WhatsApp attachment). */
export interface StoredFile {
  fileName: string
  storagePath: string
  mimeType: 'application/pdf' | 'image/png' | 'image/jpeg'
  sizeBytes: number
  /** SHA-256 hex digest; used for duplicate statement detection. */
  sha256: string
}

export const ENTITY_TYPES = [
  'company',
  'user',
  'property',
  'unit',
  'tenant',
  'lease',
  'lease_document',
  'statement',
  'statement_extraction',
  'monitoring_event',
  'monitoring_rule',
  'payment_arrangement',
  'communication',
  'message_template',
  'message_approval',
  'notification',
  'audit_log',
] as const
export type EntityType = (typeof ENTITY_TYPES)[number]
