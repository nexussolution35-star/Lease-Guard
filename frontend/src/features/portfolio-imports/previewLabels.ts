import {
  PORTFOLIO_IMPORT_FIELDS,
  type PortfolioImportFieldKey,
  type PortfolioImportRowResult,
  type PortfolioImportTenantContactDetail,
  type PortfolioImportTenantResult,
} from '@leaseguard/domain'

import { labelFor, type Tone } from '@/lib/labels'

const HEADERS = new Map(PORTFOLIO_IMPORT_FIELDS.map((field) => [field.key, field.header]))
const ENUM_FIELDS: ReadonlySet<PortfolioImportFieldKey> = new Set(['propertyType', 'unitType', 'occupancyStatus', 'tenantBusinessType'])
const AREA_FIELDS: ReadonlySet<PortfolioImportFieldKey> = new Set(['grossLettableAreaSqm', 'floorAreaSqm'])
const AREA_FORMAT = new Intl.NumberFormat('en-ZA', { maximumFractionDigits: 2 })

/** The field's name as LeaseGuard's template heads it, e.g. "Floor area (m²)". */
export function importFieldLabel(field: PortfolioImportFieldKey): string {
  return HEADERS.get(field) ?? field
}

/** A value of a conflict, for people: enum values by their label, areas in m², text as written. */
export function formatImportValue(field: PortfolioImportFieldKey, value: string): string {
  if (value === '') return '—'
  if (ENUM_FIELDS.has(field)) return labelFor(value)
  if (AREA_FIELDS.has(field) && Number.isFinite(Number(value))) return `${AREA_FORMAT.format(Number(value))} m²`
  return value
}

/** Each row result's label and status tone, in the order the filters list them. */
export const IMPORT_ROW_RESULT_DISPLAY: Readonly<Record<PortfolioImportRowResult, { label: string; tone: Tone }>> = {
  new: { label: 'New', tone: 'info' },
  match: { label: 'Matches existing', tone: 'success' },
  suggested: { label: 'Suggested match', tone: 'warning' },
  conflict: { label: 'Conflict', tone: 'warning' },
  invalid: { label: 'Invalid', tone: 'danger' },
  duplicate: { label: 'Duplicate in file', tone: 'neutral' },
  skipped: { label: 'Skipped', tone: 'neutral' },
}

/** Each tenant result's label and status tone. */
export const IMPORT_TENANT_RESULT_DISPLAY: Readonly<Record<PortfolioImportTenantResult, { label: string; tone: Tone }>> = {
  new: { label: 'New tenant', tone: 'info' },
  match: { label: 'Existing tenant', tone: 'success' },
  suggested: { label: 'Suggested match', tone: 'warning' },
  conflict: { label: 'Conflict', tone: 'warning' },
  invalid: { label: 'Invalid', tone: 'danger' },
}

const CONTACT_DETAIL_LABELS: Readonly<Record<PortfolioImportTenantContactDetail, string>> = {
  contactPerson: 'contact person',
  email: 'email',
  phone: 'phone',
}

/** The contact details a tenant is missing, in words: "No contact person or phone". */
export function missingContactDetailsLabel(missing: readonly PortfolioImportTenantContactDetail[]): string {
  const words = missing.map((detail) => CONTACT_DETAIL_LABELS[detail])
  if (words.length === 0) return ''
  const list = words.length === 1 ? words[0]! : `${words.slice(0, -1).join(', ')} or ${words[words.length - 1]!}`
  return `No ${list}`
}
