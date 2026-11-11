import { PROPERTY_STATUSES, PROPERTY_TYPES, SA_PROVINCES, STATEMENT_SOURCES } from '@leaseguard/domain'
import { z } from 'zod'

import { listQuerySchema } from '../../common/http/pagination'

export const PROPERTY_SORT_FIELDS = ['name', 'code', 'createdAt'] as const

export const propertyListQuerySchema = listQuerySchema(PROPERTY_SORT_FIELDS, {
  status: z.enum(PROPERTY_STATUSES).optional(),
  type: z.enum(PROPERTY_TYPES).optional(),
})
export type PropertyListQuery = z.infer<typeof propertyListQuerySchema>

/** API sort field → database column. */
export const PROPERTY_SORT_COLUMNS = { name: 'name', code: 'code', createdAt: 'created_at' } as const satisfies Record<
  (typeof PROPERTY_SORT_FIELDS)[number],
  string
>

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

/** Statuses a person sets directly; `archived` is reached only through the archive action. */
export const PROPERTY_EDITABLE_STATUSES = ['active', 'under_development'] as const

/** The property's street address; the country is always South Africa and is not sent. */
export const propertyAddressSchema = z.strictObject({
  line1: requiredText(200, 'Enter the street address'),
  line2: clearableText(200),
  suburb: requiredText(100, 'Enter the suburb'),
  city: requiredText(100, 'Enter the city or town'),
  province: z.enum(SA_PROVINCES),
  postalCode: z.string().trim().regex(/^[0-9]{4}$/, 'must be a four-digit South African postal code'),
})

const grossLettableArea = z
  .number()
  .positive('must be more than 0')
  .max(10_000_000, 'must be at most 10 000 000 m²')
  .refine((value) => Math.round(value * 100) === value * 100, { message: 'must have at most two decimals' })

const propertyFields = {
  name: requiredText(200, 'Enter the property name'),
  type: z.enum(PROPERTY_TYPES),
  status: z.enum(PROPERTY_EDITABLE_STATUSES),
  address: propertyAddressSchema,
  description: z.string().trim().max(2000, 'must be at most 2000 characters'),
  grossLettableAreaSqm: grossLettableArea,
  managerUserId: z.uuid(),
  ownerUserId: z.uuid().nullable(),
  accountingSystem: z.enum(STATEMENT_SOURCES),
}

/**
 * Body of POST /properties. The code is fixed once the property exists (lease references use it), so
 * it is only set here; it is upper-cased, 2–8 letters or digits, and unique in the company.
 */
export const createPropertyBodySchema = z.strictObject({
  name: propertyFields.name,
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{2,8}$/, 'must be 2 to 8 letters or digits'),
  type: propertyFields.type,
  status: propertyFields.status.optional(),
  address: propertyFields.address,
  description: propertyFields.description.optional(),
  grossLettableAreaSqm: propertyFields.grossLettableAreaSqm,
  managerUserId: propertyFields.managerUserId,
  ownerUserId: propertyFields.ownerUserId.optional(),
  accountingSystem: propertyFields.accountingSystem,
})
export type CreatePropertyBody = z.infer<typeof createPropertyBodySchema>

/** Body of PATCH /properties/:propertyId: omitted fields are unchanged; an address replaces the whole address. */
export const updatePropertyBodySchema = z
  .strictObject({
    name: propertyFields.name.optional(),
    type: propertyFields.type.optional(),
    status: propertyFields.status.optional(),
    address: propertyFields.address.optional(),
    description: propertyFields.description.optional(),
    grossLettableAreaSqm: propertyFields.grossLettableAreaSqm.optional(),
    managerUserId: propertyFields.managerUserId.optional(),
    ownerUserId: propertyFields.ownerUserId.optional(),
    accountingSystem: propertyFields.accountingSystem.optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), { message: 'Change at least one field' })
export type UpdatePropertyBody = z.infer<typeof updatePropertyBodySchema>
