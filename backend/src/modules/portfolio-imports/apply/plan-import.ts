import {
  PORTFOLIO_IMPORT_BLOCKED_RESULTS,
  PORTFOLIO_IMPORT_FIELD_KEYS,
  type EntityId,
  type PortfolioImportFieldKey,
  type PortfolioImportMissingContactDetails,
  type PortfolioImportRowCheck,
  type PortfolioImportScope,
  type StatementSource,
} from '@leaseguard/domain'

import { createPropertyBodySchema, type CreatePropertyBody } from '../../properties/properties.schemas'
import { createTenantBodySchema, type CreateTenantBody } from '../../tenants/tenants.schemas'
import { createUnitBodySchema, type CreateUnitBody } from '../../units/units.schemas'
import { parsePortfolioField, TENANT_FIELDS, tenantBusinessTypeOf } from '../preview/check-rows'

/** A property the import creates: the row that first names it, and its values as the property form reads them. */
export interface PlannedProperty {
  rowNumber: number
  code: string
  values: Partial<Record<PortfolioImportFieldKey, unknown>>
}

/** A unit the import creates, in an existing property (`propertyId`) or one the import creates (`propertyCode`). */
export interface PlannedUnit {
  rowNumber: number
  propertyId?: EntityId
  propertyCode?: string
  values: Partial<Record<PortfolioImportFieldKey, unknown>>
}

/**
 * A tenant the import creates (ticket I-05), as the tenant of the unit its row names: an existing unit (`unitId`), or
 * the unit `unitNumber` of an existing property (`propertyId`) or of one the import creates (`propertyCode`).
 */
export interface PlannedTenant {
  rowNumber: number
  unitId?: EntityId
  propertyId?: EntityId
  propertyCode?: string
  unitNumber?: string
  values: Partial<Record<PortfolioImportFieldKey, unknown>>
}

export interface PortfolioImportPlan {
  properties: PlannedProperty[]
  units: PlannedUnit[]
  tenants: PlannedTenant[]
  linkedRows: number
  skippedRows: number
  blockedRows: number
  /** Rows whose tenant is a tenant in LeaseGuard (identifier in common, or confirmed). */
  tenantsLinked: number
  /** Rows whose suggested tenant waits on the manager. */
  tenantSuggestionsToReview: number
  missingContactDetails: PortfolioImportMissingContactDetails[]
}

export interface PlanImportInput {
  scope: PortfolioImportScope
  /** The batch's property (scope `units`). */
  propertyId?: EntityId
  /** Every row of the batch, checked against the live records, in file order. */
  rows: readonly PortfolioImportRowCheck[]
}

const UNIT_FIELDS: readonly PortfolioImportFieldKey[] = ['unitNumber', 'unitType', 'floorAreaSqm', 'occupancyStatus']
const NOT_PROPERTY_FIELDS: ReadonlySet<PortfolioImportFieldKey> = new Set([...UNIT_FIELDS, ...TENANT_FIELDS])

/** The row's values read as the property and unit forms read them; a value that cannot be read is left out. */
function readValues(row: PortfolioImportRowCheck): Partial<Record<PortfolioImportFieldKey, unknown>> {
  const values: Partial<Record<PortfolioImportFieldKey, unknown>> = {}
  for (const field of PORTFOLIO_IMPORT_FIELD_KEYS) {
    const text = row.values[field]
    if (text === undefined) continue
    const parsed = parsePortfolioField(field, text)
    if ('value' in parsed && parsed.value !== null && parsed.value !== undefined) values[field] = parsed.value
  }
  return values
}

const pick = (values: Partial<Record<PortfolioImportFieldKey, unknown>>, fields: readonly PortfolioImportFieldKey[]) =>
  Object.fromEntries(fields.filter((field) => values[field] !== undefined).map((field) => [field, values[field]])) as Partial<
    Record<PortfolioImportFieldKey, unknown>
  >

/**
 * What approving the batch now creates, from its rows checked against the live records. Only `new` rows add records:
 * a property the file names for the first time (by its code, from the first row naming it; later rows only fill values
 * the first left empty), a unit not yet in its property, and a tenant not yet in LeaseGuard (from the first row naming
 * it). `match` rows are linked to the records that exist, `skipped` rows are left out, and rows still blocked (invalid,
 * conflict, duplicate, suggested) stay out until they are fixed. Rows with a new tenant that leave contact details
 * empty are listed, whether or not they are blocked.
 */
export function planPortfolioImport(input: PlanImportInput): PortfolioImportPlan {
  const blocked: ReadonlySet<string> = new Set(PORTFOLIO_IMPORT_BLOCKED_RESULTS)
  const properties = new Map<string, PlannedProperty>()
  const units: PlannedUnit[] = []
  const tenants: PlannedTenant[] = []
  const missingContactDetails: PortfolioImportMissingContactDetails[] = []
  let linkedRows = 0
  let skippedRows = 0
  let blockedRows = 0
  let tenantsLinked = 0
  let tenantSuggestionsToReview = 0

  for (const row of input.rows) {
    if (row.result === 'match') linkedRows += 1
    else if (row.result === 'skipped') skippedRows += 1
    else if (blocked.has(row.result)) blockedRows += 1
    if (row.result === 'suggested') tenantSuggestionsToReview += 1
    const tenant = row.result === 'skipped' ? undefined : row.tenant
    if (tenant && (row.result === 'new' || row.result === 'match') && tenant.result === 'match') tenantsLinked += 1
    if (tenant && (tenant.result === 'new' || tenant.result === 'invalid') && tenant.sameAsRowNumber === undefined && tenant.missingContactDetails.length > 0) {
      missingContactDetails.push({
        rowNumber: row.rowNumber,
        tenantName: tenant.name,
        missing: tenant.missingContactDetails,
        blocksCreation: tenant.missingContactDetails.some((detail) => detail !== 'email'),
      })
    }
    if (row.result !== 'new') continue

    const values = readValues(row)
    const unitValues = pick(values, UNIT_FIELDS)
    const addsUnit = row.unit === undefined && unitValues.unitNumber !== undefined
    const unitNumber = typeof unitValues.unitNumber === 'string' ? unitValues.unitNumber : undefined
    const addsTenant = tenant?.result === 'new' && tenant.sameAsRowNumber === undefined
    const tenantValues = pick(values, TENANT_FIELDS)

    const planTenant = (unit: { propertyId: EntityId } | { propertyCode: string }) => {
      if (!addsTenant) return
      if (row.unit) tenants.push({ rowNumber: row.rowNumber, unitId: row.unit.id, values: tenantValues })
      else if (unitNumber) tenants.push({ rowNumber: row.rowNumber, ...unit, unitNumber, values: tenantValues })
    }

    if (input.scope === 'units') {
      if (addsUnit && input.propertyId) units.push({ rowNumber: row.rowNumber, propertyId: input.propertyId, values: unitValues })
      if (input.propertyId) planTenant({ propertyId: input.propertyId })
      continue
    }

    if (row.property) {
      if (addsUnit) units.push({ rowNumber: row.rowNumber, propertyId: row.property.id, values: unitValues })
      planTenant({ propertyId: row.property.id })
      continue
    }

    // A new property is named by its code (a property without one is never `new`).
    const code = typeof values.propertyCode === 'string' ? values.propertyCode : undefined
    if (!code) continue
    const propertyValues = pick(values, PORTFOLIO_IMPORT_FIELD_KEYS.filter((field) => !NOT_PROPERTY_FIELDS.has(field)))
    const planned = properties.get(code)
    if (planned) {
      for (const [field, value] of Object.entries(propertyValues) as [PortfolioImportFieldKey, unknown][]) {
        if (planned.values[field] === undefined) planned.values[field] = value
      }
    } else {
      properties.set(code, { rowNumber: row.rowNumber, code, values: propertyValues })
    }
    if (addsUnit) units.push({ rowNumber: row.rowNumber, propertyCode: code, values: unitValues })
    planTenant({ propertyCode: code })
  }

  return {
    properties: [...properties.values()],
    units,
    tenants,
    linkedRows,
    skippedRows,
    blockedRows,
    tenantsLinked,
    tenantSuggestionsToReview,
    missingContactDetails,
  }
}

/** Who the new properties belong to: the manager (the approver) and the accounting system their statements come from. */
export interface NewPropertyDefaults {
  managerUserId: EntityId
  accountingSystem: StatementSource
}

/**
 * The property form's create body for a planned property, held to the form's own validation. Returns the problem in
 * words when a value breaks a rule (the row was checked with the same rules, so this means it changed meanwhile).
 */
export function plannedPropertyBody(planned: PlannedProperty, defaults: NewPropertyDefaults): { body: CreatePropertyBody } | { problem: string } {
  const v = planned.values
  const parsed = createPropertyBodySchema.safeParse({
    name: v.propertyName,
    code: planned.code,
    type: v.propertyType,
    status: 'active',
    address: {
      line1: v.addressLine1,
      ...(v.addressLine2 !== undefined ? { line2: v.addressLine2 } : {}),
      suburb: v.suburb,
      city: v.city,
      province: v.province,
      postalCode: v.postalCode,
    },
    grossLettableAreaSqm: v.grossLettableAreaSqm,
    managerUserId: defaults.managerUserId,
    accountingSystem: defaults.accountingSystem,
  })
  if (!parsed.success) return { problem: `Row ${planned.rowNumber}: ${parsed.error.issues[0]?.message ?? 'the property is not valid'}` }
  return { body: parsed.data }
}

/** The unit form's create body for a planned unit (its property filled in by the caller), held to the form's validation. */
export function plannedUnitBody(planned: PlannedUnit, propertyId: EntityId): { body: CreateUnitBody } | { problem: string } {
  const v = planned.values
  const parsed = createUnitBodySchema.safeParse({
    propertyId,
    unitNumber: v.unitNumber,
    type: v.unitType,
    floorAreaSqm: v.floorAreaSqm,
    ...(v.occupancyStatus !== undefined ? { occupancyStatus: v.occupancyStatus } : {}),
  })
  if (!parsed.success) return { problem: `Row ${planned.rowNumber}: ${parsed.error.issues[0]?.message ?? 'the unit is not valid'}` }
  return { body: parsed.data }
}

/**
 * The tenant form's create body for a planned tenant, held to the form's own validation: the phone is the contact's
 * phone and the WhatsApp number (validated later, before any automated message), the email the contact's and the
 * tenant's, and the business type the column's or the one the registration number states.
 */
export function plannedTenantBody(planned: PlannedTenant): { body: CreateTenantBody } | { problem: string } {
  const v = planned.values
  const parsed = createTenantBodySchema.safeParse({
    legalName: v.tenantLegalName,
    ...(v.tenantTradingName !== undefined ? { tradingName: v.tenantTradingName } : {}),
    businessType: tenantBusinessTypeOf(v),
    ...(v.tenantRegistrationNumber !== undefined ? { registrationNumber: v.tenantRegistrationNumber } : {}),
    ...(v.tenantAccountReference !== undefined ? { accountReference: v.tenantAccountReference } : {}),
    primaryContact: {
      fullName: v.tenantContactPerson,
      phone: v.tenantPhone,
      ...(v.tenantEmail !== undefined ? { email: v.tenantEmail } : {}),
    },
    whatsappNumber: v.tenantPhone,
    ...(v.tenantEmail !== undefined ? { email: v.tenantEmail } : {}),
  })
  if (!parsed.success) return { problem: `Row ${planned.rowNumber}: ${parsed.error.issues[0]?.message ?? 'the tenant is not valid'}` }
  return { body: parsed.data }
}
