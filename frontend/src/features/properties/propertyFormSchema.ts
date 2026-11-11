import { PROPERTY_TYPES, SA_PROVINCES, STATEMENT_SOURCES, type Property } from '@leaseguard/domain'
import { z } from 'zod'

import type { NewProperty, PropertyChanges } from './api/source'

/** Owner select value for "no owner" (a select option cannot have an empty value). */
export const NO_OWNER = 'none'

/** Statuses chosen in the form; archived is reached only through the archive action. */
export const EDITABLE_PROPERTY_STATUSES = ['active', 'under_development'] as const

const required = (label: string, max: number) =>
  z
    .string()
    .trim()
    .min(1, `Enter ${label}`)
    .max(max, `Use at most ${max} characters`)

const optional = (max: number) => z.string().trim().max(max, `Use at most ${max} characters`)

/**
 * The property form (create and edit), with the API's rules. The code is only set on create: it is fixed once the
 * property exists because lease references use it.
 */
export const propertyFormSchema = z.object({
  name: required('the property name', 200),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{2,8}$/, 'Use 2 to 8 letters or digits, e.g. MSQ'),
  type: z.enum(PROPERTY_TYPES, { error: 'Choose a property type' }),
  status: z.enum(EDITABLE_PROPERTY_STATUSES, { error: 'Choose a status' }),
  line1: required('the street address', 200),
  line2: optional(200),
  suburb: required('the suburb', 100),
  city: required('the city or town', 100),
  province: z.enum(SA_PROVINCES, { error: 'Choose a province' }),
  postalCode: z
    .string()
    .trim()
    .regex(/^[0-9]{4}$/, 'Enter the four-digit postal code'),
  description: optional(2000),
  grossLettableAreaSqm: z
    .number({ error: 'Enter the gross lettable area' })
    .positive('The area must be more than 0 m²')
    .max(10_000_000, 'Use at most 10 000 000 m²')
    .refine((value) => Math.round(value * 100) / 100 === value, { message: 'Use at most two decimals' }),
  managerUserId: z.string().min(1, 'Choose the property manager'),
  ownerUserId: z.string(),
  accountingSystem: z.enum(STATEMENT_SOURCES, { error: 'Choose the accounting system' }),
})

export type PropertyFormInput = z.input<typeof propertyFormSchema>
export type PropertyFormValues = z.output<typeof propertyFormSchema>

/** Empty form for a new property; the signed-in user is the suggested manager. */
export function newPropertyFormDefaults(managerUserId: string | null): PropertyFormInput {
  return {
    name: '',
    code: '',
    type: '' as PropertyFormInput['type'],
    status: 'active',
    line1: '',
    line2: '',
    suburb: '',
    city: '',
    province: '' as PropertyFormInput['province'],
    postalCode: '',
    description: '',
    grossLettableAreaSqm: undefined as unknown as number,
    managerUserId: managerUserId ?? '',
    ownerUserId: NO_OWNER,
    accountingSystem: '' as PropertyFormInput['accountingSystem'],
  }
}

/** Form values for an existing property. An archived property is not edited (restore it first). */
export function propertyFormDefaults(property: Property): PropertyFormInput {
  return {
    name: property.name,
    code: property.code,
    type: property.type,
    status: property.status === 'under_development' ? 'under_development' : 'active',
    line1: property.address.line1,
    line2: property.address.line2 ?? '',
    suburb: property.address.suburb,
    city: property.address.city,
    province: property.address.province,
    postalCode: property.address.postalCode,
    description: property.description,
    grossLettableAreaSqm: property.grossLettableAreaSqm,
    managerUserId: property.managerUserId,
    ownerUserId: property.ownerUserId ?? NO_OWNER,
    accountingSystem: property.accountingSystem,
  }
}

const ownerOf = (value: string): string | null => (value === NO_OWNER || value === '' ? null : value)

function addressOf(values: PropertyFormValues): NewProperty['address'] {
  return {
    line1: values.line1,
    line2: values.line2 === '' ? null : values.line2,
    suburb: values.suburb,
    city: values.city,
    province: values.province,
    postalCode: values.postalCode,
  }
}

/** The `POST /properties` body. */
export function newPropertyFrom(values: PropertyFormValues): NewProperty {
  const owner = ownerOf(values.ownerUserId)
  return {
    name: values.name,
    code: values.code,
    type: values.type,
    status: values.status,
    address: addressOf(values),
    ...(values.description === '' ? {} : { description: values.description }),
    grossLettableAreaSqm: values.grossLettableAreaSqm,
    managerUserId: values.managerUserId,
    ...(owner === null ? {} : { ownerUserId: owner }),
    accountingSystem: values.accountingSystem,
  }
}

/**
 * The `PATCH /properties/{id}` body for the fields that differ from the saved property, or null when nothing changed.
 * A changed address field sends the whole address; removing the owner sends null.
 */
export function propertyChangesFrom(values: PropertyFormValues, property: Property): PropertyChanges | null {
  const saved = propertyFormSchema.safeParse(propertyFormDefaults(property))
  const before: Partial<PropertyFormValues> = saved.success ? saved.data : {}
  const changed = (field: keyof PropertyFormValues) => values[field] !== before[field]

  const changes: PropertyChanges = {}
  if (changed('name')) changes.name = values.name
  if (changed('type')) changes.type = values.type
  if (changed('status')) changes.status = values.status
  if (changed('description')) changes.description = values.description
  if (changed('grossLettableAreaSqm')) changes.grossLettableAreaSqm = values.grossLettableAreaSqm
  if (changed('managerUserId')) changes.managerUserId = values.managerUserId
  if (ownerOf(values.ownerUserId) !== (property.ownerUserId ?? null)) changes.ownerUserId = ownerOf(values.ownerUserId)
  if (changed('accountingSystem')) changes.accountingSystem = values.accountingSystem
  if ((['line1', 'line2', 'suburb', 'city', 'province', 'postalCode'] as const).some(changed)) changes.address = addressOf(values)
  return Object.keys(changes).length > 0 ? changes : null
}

export type PropertyFormField = keyof PropertyFormValues

/**
 * Where an API refusal belongs in the form: a duplicate code (409) on the code field, a manager or owner who does not
 * qualify (422) on the manager field; anything else is shown above the form.
 */
export function propertyErrorField(status: number, message: string): PropertyFormField | null {
  if (status === 409 && /code/i.test(message)) return 'code'
  if (status === 422 && /manager|owner/i.test(message)) return /owner/i.test(message) && !/manager/i.test(message) ? 'ownerUserId' : 'managerUserId'
  return null
}
