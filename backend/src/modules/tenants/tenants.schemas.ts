import { BUSINESS_TYPES, normalizeWhatsAppNumber, TENANT_STATUSES } from '@leaseguard/domain'
import { z } from 'zod'

import { listQuerySchema } from '../../common/http/pagination'

export const TENANT_SORT_FIELDS = ['tradingName', 'legalName', 'status', 'createdAt'] as const

// Tenants have no property column: `propertyId` keeps the tenants with a lease in that property (through leases).
export const tenantListQuerySchema = listQuerySchema(TENANT_SORT_FIELDS, {
  status: z.enum(TENANT_STATUSES).optional(),
  businessType: z.enum(BUSINESS_TYPES).optional(),
  propertyId: z.uuid().optional(),
})
export type TenantListQuery = z.infer<typeof tenantListQuerySchema>

/** API sort field → database column. */
export const TENANT_SORT_COLUMNS = {
  tradingName: 'trading_name',
  legalName: 'legal_name',
  status: 'status',
  createdAt: 'created_at',
} as const satisfies Record<(typeof TENANT_SORT_FIELDS)[number], string>

const requiredText = (max: number, blank: string) =>
  z
    .string()
    .trim()
    .max(max, `must be at most ${max} characters`)
    .refine((value) => value !== '', { message: blank })

/** Optional text that can be cleared: '' or null clears it, omitted leaves it unchanged. */
const clearableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `must be at most ${max} characters`)
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional()

/** An email address that can be cleared the same way. */
const clearableEmail = z
  .string()
  .trim()
  .transform((value) => (value === '' ? null : value.toLowerCase()))
  .pipe(z.email('must be a valid email address').max(254, 'must be at most 254 characters').nullable())
  .nullable()
  .optional()

/**
 * The tenant's WhatsApp number as typed (`082 123 4567`, `+27 82 123 4567`), stored in E.164. Anything that is not a
 * dialable number is refused with the format to use (`normalizeWhatsAppNumber`).
 */
export const whatsappNumberSchema = z.string().transform((value, ctx) => {
  const result = normalizeWhatsAppNumber(value)
  if (result.ok) return result.number
  ctx.addIssue({ code: 'custom', message: result.reason })
  return z.NEVER
})

const tenantFields = {
  legalName: requiredText(200, 'Enter the registered business name'),
  tradingName: requiredText(200, 'Enter the trading name'),
  businessType: z.enum(BUSINESS_TYPES),
  registrationNumber: clearableText(50),
  accountReference: clearableText(50),
  vatNumber: clearableText(20),
  contactFullName: requiredText(200, 'Enter the contact person'),
  contactRole: z.string().trim().max(100, 'must be at most 100 characters'),
  contactPhone: requiredText(30, 'Enter the contact phone number'),
  whatsappNumber: whatsappNumberSchema,
  email: clearableEmail,
  status: z.enum(TENANT_STATUSES),
  industry: z.string().trim().max(100, 'must be at most 100 characters'),
  notes: clearableText(2000),
}

/** The tenant's contact person in a create request. The phone is the WhatsApp number when omitted. */
export const tenantContactInputSchema = z.strictObject({
  fullName: tenantFields.contactFullName,
  role: tenantFields.contactRole.optional(),
  phone: tenantFields.contactPhone.optional(),
  email: clearableEmail,
})

/** The contact person in an edit: omitted fields are unchanged. */
export const tenantContactChangesSchema = z
  .strictObject({
    fullName: tenantFields.contactFullName.optional(),
    role: tenantFields.contactRole.optional(),
    phone: tenantFields.contactPhone.optional(),
    email: clearableEmail,
  })
  .refine((contact) => Object.values(contact).some((value) => value !== undefined), { message: 'Change at least one contact field' })

/**
 * Body of POST /tenants. The registered name is required; the trading name is the registered name when omitted. A new
 * tenant's WhatsApp number always starts unvalidated: automated communication stays off until it is validated.
 */
export const createTenantBodySchema = z.strictObject({
  legalName: tenantFields.legalName,
  tradingName: tenantFields.tradingName.optional(),
  businessType: tenantFields.businessType,
  registrationNumber: tenantFields.registrationNumber,
  accountReference: tenantFields.accountReference,
  vatNumber: tenantFields.vatNumber,
  primaryContact: tenantContactInputSchema,
  whatsappNumber: tenantFields.whatsappNumber,
  email: tenantFields.email,
  status: tenantFields.status.optional(),
  industry: tenantFields.industry.optional(),
  notes: tenantFields.notes,
})
export type CreateTenantBody = z.infer<typeof createTenantBodySchema>

/**
 * Body of PATCH /tenants/:tenantId: omitted fields are unchanged. A different WhatsApp number is unvalidated again (the
 * database resets the flag and records it in the audit log).
 */
export const updateTenantBodySchema = z
  .strictObject({
    legalName: tenantFields.legalName.optional(),
    tradingName: tenantFields.tradingName.optional(),
    businessType: tenantFields.businessType.optional(),
    registrationNumber: tenantFields.registrationNumber,
  accountReference: tenantFields.accountReference,
    vatNumber: tenantFields.vatNumber,
    primaryContact: tenantContactChangesSchema.optional(),
    whatsappNumber: tenantFields.whatsappNumber.optional(),
    email: tenantFields.email,
    status: tenantFields.status.optional(),
    industry: tenantFields.industry.optional(),
    notes: tenantFields.notes,
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), { message: 'Change at least one field' })
export type UpdateTenantBody = z.infer<typeof updateTenantBodySchema>

/**
 * Body of POST /tenants/:tenantId/whatsapp-validation: the number the person checked, typed or in E.164. It must still
 * be the tenant's number on record (409 otherwise), so a number changed in the meantime is never validated by mistake.
 */
export const validateTenantWhatsAppBodySchema = z.strictObject({ whatsappNumber: whatsappNumberSchema })
export type ValidateTenantWhatsAppBody = z.infer<typeof validateTenantWhatsAppBodySchema>
