import { SA_PROVINCES } from '@leaseguard/domain'
import { z } from 'zod'

import type { CompanyChanges, CompanyProfile } from './api/source'

const required = (label: string, max: number) =>
  z
    .string()
    .trim()
    .min(1, `Enter ${label}`)
    .max(max, `Use at most ${max} characters`)

const optional = (max: number) => z.string().trim().max(max, `Use at most ${max} characters`)

/**
 * The company profile form: the fields a company admin may change (`PATCH /companies/{id}`), with the
 * API's own limits. Status, initials, timezone and country are managed by Nexus and are not in the form.
 */
export const companyProfileFormSchema = z.object({
  name: required('the registered company name', 200),
  tradingName: optional(200),
  registrationNumber: optional(50),
  vatNumber: optional(30),
  line1: required('the street address', 200),
  line2: optional(200),
  suburb: required('the suburb', 100),
  city: required('the city or town', 100),
  province: z.enum(SA_PROVINCES, { error: 'Choose a province' }),
  postalCode: z
    .string()
    .trim()
    .regex(/^[0-9]{4}$/, 'Enter the four-digit postal code'),
  contactEmail: z.string().trim().max(320, 'Use at most 320 characters').pipe(z.email('Enter a valid email address')),
  contactPhone: required('a contact phone number', 30),
})

export type CompanyProfileFormInput = z.input<typeof companyProfileFormSchema>
export type CompanyProfileFormValues = z.output<typeof companyProfileFormSchema>

type ProfileFields = Pick<
  CompanyProfile,
  'name' | 'tradingName' | 'registrationNumber' | 'vatNumber' | 'address' | 'contactEmail' | 'contactPhone'
>

/** Form values for a company; optional fields that are not set are empty. */
export function companyProfileFormDefaults(company: ProfileFields): CompanyProfileFormInput {
  return {
    name: company.name,
    tradingName: company.tradingName ?? '',
    registrationNumber: company.registrationNumber ?? '',
    vatNumber: company.vatNumber ?? '',
    line1: company.address.line1,
    line2: company.address.line2 ?? '',
    suburb: company.address.suburb,
    city: company.address.city,
    province: company.address.province,
    postalCode: company.address.postalCode,
    contactEmail: company.contactEmail,
    contactPhone: company.contactPhone,
  }
}

/**
 * The `PATCH /companies/{id}` body for the fields that differ from the saved company, or null when
 * nothing changed (the API refuses an empty change). An emptied optional field is sent as null, which
 * clears it; a changed address field sends the whole address, which the API replaces as one.
 */
export function companyProfileChangesFrom(values: CompanyProfileFormValues, company: ProfileFields): CompanyChanges | null {
  const saved = companyProfileFormSchema.safeParse(companyProfileFormDefaults(company))
  const before: Partial<CompanyProfileFormValues> = saved.success ? saved.data : {}
  const changed = (field: keyof CompanyProfileFormValues) => values[field] !== before[field]
  const orNull = (value: string) => (value === '' ? null : value)

  const changes: CompanyChanges = {}
  if (changed('name')) changes.name = values.name
  if (changed('tradingName')) changes.tradingName = orNull(values.tradingName)
  if (changed('registrationNumber')) changes.registrationNumber = orNull(values.registrationNumber)
  if (changed('vatNumber')) changes.vatNumber = orNull(values.vatNumber)
  if (changed('contactEmail')) changes.contactEmail = values.contactEmail
  if (changed('contactPhone')) changes.contactPhone = values.contactPhone
  if ((['line1', 'line2', 'suburb', 'city', 'province', 'postalCode'] as const).some(changed)) {
    changes.address = {
      line1: values.line1,
      line2: orNull(values.line2),
      suburb: values.suburb,
      city: values.city,
      province: values.province,
      postalCode: values.postalCode,
    }
  }
  return Object.keys(changes).length > 0 ? changes : null
}
