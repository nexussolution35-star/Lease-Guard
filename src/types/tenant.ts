import type { CompanyScoped } from './common'

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
  vatNumber?: string
  primaryContact: TenantContact
  /** E.164 number used for WhatsApp, e.g. `+27821234567`. */
  whatsappNumber: string
  /** Numbers must be validated before automated communication is enabled. */
  whatsappVerified: boolean
  whatsappOptedOut: boolean
  email?: string
  status: TenantStatus
  industry: string
  notes?: string
}
