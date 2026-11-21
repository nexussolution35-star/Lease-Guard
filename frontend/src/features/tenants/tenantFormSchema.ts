import { BUSINESS_TYPES, normalizeWhatsAppNumber, TENANT_STATUSES, type Tenant } from '@leaseguard/domain'
import { z } from 'zod'

import type { NewTenant, TenantChanges } from './api/source'

const required = (label: string, max: number) =>
  z
    .string()
    .trim()
    .min(1, `Enter ${label}`)
    .max(max, `Use at most ${max} characters`)

const optional = (max: number) => z.string().trim().max(max, `Use at most ${max} characters`)

const optionalEmail = z
  .string()
  .trim()
  .max(254, 'Use at most 254 characters')
  .refine((value) => value === '' || z.email().safeParse(value).success, { message: 'Enter a valid email address' })

/**
 * The tenant form (create and edit), with the API's rules. The WhatsApp number is typed as people write it and comes
 * out in E.164 through the same rule the API applies (`normalizeWhatsAppNumber`), so an invalid number is refused
 * before it is sent, with the format to use.
 */
export const tenantFormSchema = z.object({
  legalName: required('the registered business name', 200),
  tradingName: optional(200),
  businessType: z.enum(BUSINESS_TYPES, { error: 'Choose a business type' }),
  registrationNumber: optional(50),
  vatNumber: optional(20),
  contactFullName: required('the contact person', 200),
  contactRole: optional(100),
  contactPhone: optional(30),
  contactEmail: optionalEmail,
  whatsappNumber: z.string().transform((value, ctx) => {
    const result = normalizeWhatsAppNumber(value)
    if (result.ok) return result.number
    ctx.addIssue({ code: 'custom', message: result.reason })
    return z.NEVER
  }),
  email: optionalEmail,
  status: z.enum(TENANT_STATUSES, { error: 'Choose a status' }),
  industry: optional(100),
  notes: optional(2000),
})

export type TenantFormInput = z.input<typeof tenantFormSchema>
export type TenantFormValues = z.output<typeof tenantFormSchema>
export type TenantFormField = keyof TenantFormValues

/** Empty form for a new tenant: prospective until its lease is in place. */
export function newTenantFormDefaults(): TenantFormInput {
  return {
    legalName: '',
    tradingName: '',
    businessType: '' as TenantFormInput['businessType'],
    registrationNumber: '',
    vatNumber: '',
    contactFullName: '',
    contactRole: '',
    contactPhone: '',
    contactEmail: '',
    whatsappNumber: '',
    email: '',
    status: 'prospective',
    industry: '',
    notes: '',
  }
}

/** Form values for an existing tenant. */
export function tenantFormDefaults(tenant: Tenant): TenantFormInput {
  return {
    legalName: tenant.legalName,
    tradingName: tenant.tradingName,
    businessType: tenant.businessType,
    registrationNumber: tenant.registrationNumber ?? '',
    vatNumber: tenant.vatNumber ?? '',
    contactFullName: tenant.primaryContact.fullName,
    contactRole: tenant.primaryContact.role,
    contactPhone: tenant.primaryContact.phone,
    contactEmail: tenant.primaryContact.email ?? '',
    whatsappNumber: tenant.whatsappNumber,
    email: tenant.email ?? '',
    status: tenant.status,
    industry: tenant.industry,
    notes: tenant.notes ?? '',
  }
}

/** The `POST /tenants` body. Empty optional fields are left out: the API fills the trading name and contact phone. */
export function newTenantFrom(values: TenantFormValues): NewTenant {
  const set = <T extends string>(value: T) => (value === '' ? undefined : value)
  const contactRole = set(values.contactRole)
  const contactPhone = set(values.contactPhone)
  const contactEmail = set(values.contactEmail)
  const body: NewTenant = {
    legalName: values.legalName,
    businessType: values.businessType,
    primaryContact: {
      fullName: values.contactFullName,
      ...(contactRole ? { role: contactRole } : {}),
      ...(contactPhone ? { phone: contactPhone } : {}),
      ...(contactEmail ? { email: contactEmail } : {}),
    },
    whatsappNumber: values.whatsappNumber,
    status: values.status,
  }
  for (const field of ['tradingName', 'registrationNumber', 'vatNumber', 'email', 'industry', 'notes'] as const) {
    const value = set(values[field])
    if (value) body[field] = value
  }
  return body
}

/**
 * The `PATCH /tenants/{id}` body for the fields that differ from the saved tenant, or null when nothing changed. An
 * emptied optional field is sent as null; an emptied trading name becomes the registered name and an emptied contact
 * phone the WhatsApp number, as on create. A different WhatsApp number comes back unvalidated.
 */
export function tenantChangesFrom(values: TenantFormValues, tenant: Tenant): TenantChanges | null {
  const changes: TenantChanges = {}
  const tradingName = values.tradingName === '' ? values.legalName : values.tradingName
  const contactPhone = values.contactPhone === '' ? values.whatsappNumber : values.contactPhone
  const orNull = (value: string) => (value === '' ? null : value)

  if (values.legalName !== tenant.legalName) changes.legalName = values.legalName
  if (tradingName !== tenant.tradingName) changes.tradingName = tradingName
  if (values.businessType !== tenant.businessType) changes.businessType = values.businessType
  if (orNull(values.registrationNumber) !== (tenant.registrationNumber ?? null)) changes.registrationNumber = orNull(values.registrationNumber)
  if (orNull(values.vatNumber) !== (tenant.vatNumber ?? null)) changes.vatNumber = orNull(values.vatNumber)
  if (values.whatsappNumber !== tenant.whatsappNumber) changes.whatsappNumber = values.whatsappNumber
  if (orNull(values.email) !== (tenant.email ?? null)) changes.email = orNull(values.email)
  if (values.status !== tenant.status) changes.status = values.status
  if (values.industry !== tenant.industry) changes.industry = values.industry
  if (orNull(values.notes) !== (tenant.notes ?? null)) changes.notes = orNull(values.notes)

  const contact: NonNullable<TenantChanges['primaryContact']> = {}
  const saved = tenant.primaryContact
  if (values.contactFullName !== saved.fullName) contact.fullName = values.contactFullName
  if (values.contactRole !== saved.role) contact.role = values.contactRole
  if (contactPhone !== saved.phone) contact.phone = contactPhone
  if (orNull(values.contactEmail) !== (saved.email ?? null)) contact.email = orNull(values.contactEmail)
  if (Object.keys(contact).length > 0) changes.primaryContact = contact

  return Object.keys(changes).length > 0 ? changes : null
}

/** API body paths (`field: message`) → form fields. */
const API_FIELDS: Readonly<Record<string, TenantFormField>> = {
  legalName: 'legalName',
  tradingName: 'tradingName',
  businessType: 'businessType',
  registrationNumber: 'registrationNumber',
  vatNumber: 'vatNumber',
  'primaryContact.fullName': 'contactFullName',
  'primaryContact.role': 'contactRole',
  'primaryContact.phone': 'contactPhone',
  'primaryContact.email': 'contactEmail',
  whatsappNumber: 'whatsappNumber',
  email: 'email',
  status: 'status',
  industry: 'industry',
  notes: 'notes',
}

/**
 * Where an API refusal belongs in the form: a 400 naming a field (`whatsappNumber: Enter the WhatsApp number …`) goes
 * on that field, without the field name; anything else is shown above the form.
 */
export function tenantErrorField(status: number, messages: readonly string[]): { field: TenantFormField; message: string } | null {
  if (status !== 400) return null
  for (const raw of messages) {
    const match = /^([\w.]+): (.+)$/.exec(raw)
    const field = match ? API_FIELDS[match[1] ?? ''] : undefined
    if (match && field) {
      const text = match[2] ?? ''
      return { field, message: text.charAt(0).toUpperCase() + text.slice(1) }
    }
  }
  return null
}
