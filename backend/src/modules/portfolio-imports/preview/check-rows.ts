import {
  PORTFOLIO_IMPORT_FIELDS,
  areSimilarTenantNames,
  businessTypeFromRegistrationNumber,
  portfolioImportFieldsFor,
  portfolioTenantIdentifierKey,
  readPortfolioBusinessType,
  readPortfolioNumber,
  readPortfolioOccupancyStatus,
  readPortfolioPostalCode,
  readPortfolioPropertyType,
  readPortfolioProvince,
  readPortfolioTenantPhone,
  readPortfolioUnitType,
  tenantNameKey,
  type BusinessType,
  type EntityId,
  type OccupancyStatus,
  type PortfolioCellReading,
  type PortfolioImportColumnMapping,
  type PortfolioImportConflict,
  type PortfolioImportCorrection,
  type PortfolioImportFieldKey,
  type PortfolioImportMatchedRecord,
  type PortfolioImportRowCheck,
  type PortfolioImportRowResolution,
  type PortfolioImportScope,
  type PortfolioImportTenantCheck,
  type PortfolioImportTenantContactDetail,
  type PortfolioImportTenantSuggestion,
  type PropertyStatus,
  type PropertyType,
  type SAProvince,
  type UnitType,
} from '@leaseguard/domain'
import type { z } from 'zod'

import { createPropertyBodySchema, propertyAddressSchema } from '../../properties/properties.schemas'
import { createTenantBodySchema, tenantContactInputSchema, whatsappNumberSchema } from '../../tenants/tenants.schemas'
import { createUnitBodySchema } from '../../units/units.schemas'
import type { SourceRow } from '../spreadsheet/table'

/** An existing property, as far as an import compares it. */
export interface ExistingProperty {
  id: EntityId
  code: string
  name: string
  type: PropertyType
  status: PropertyStatus
  addressLine1: string
  addressLine2: string | null
  suburb: string
  city: string
  province: SAProvince
  postalCode: string
  grossLettableAreaSqm: number
}

/** An existing unit, as far as an import compares it. */
export interface ExistingUnit {
  id: EntityId
  propertyId: EntityId
  unitNumber: string
  type: UnitType
  floorAreaSqm: number
  occupancyStatus: OccupancyStatus
}

/** An existing tenant, as far as an import compares it (ticket I-05). */
export interface ExistingTenant {
  id: EntityId
  tradingName: string
  legalName: string
  registrationNumber: string | null
  accountReference: string | null
}

/** What the manager changed on a batch row, as stored (tickets I-03, I-05). */
export interface StoredRowResolution {
  /** Values per field read instead of the file's cells; an empty string clears the cell. */
  corrections: Partial<Record<PortfolioImportFieldKey, string>>
  skipped: boolean
  linkedPropertyId?: EntityId
  linkedUnitId?: EntityId
  /** The existing tenant the manager confirmed the row's tenant is. */
  linkedTenantId?: EntityId
  /** The manager rejected the suggested tenants: the row's tenant is a new one. */
  tenantSuggestionsRejected?: boolean
  changedByUserId?: EntityId
  changedAt?: string
}

/** A batch row with what the manager changed on it, if anything. */
export interface ResolvedSourceRow extends SourceRow {
  resolution?: StoredRowResolution
}

export interface CheckRowsInput {
  scope: PortfolioImportScope
  /** The batch's property (scope `units`); it must be one of `properties`. */
  propertyId?: EntityId
  columns: readonly string[]
  mapping: PortfolioImportColumnMapping
  rows: readonly ResolvedSourceRow[]
  properties: readonly ExistingProperty[]
  units: readonly ExistingUnit[]
  /** The company's tenants, to match the rows' tenants against; none when omitted. */
  tenants?: readonly ExistingTenant[]
  /** The tenant an earlier approval of this batch created from each row, by row number. */
  createdTenants?: ReadonlyMap<number, EntityId>
}

const PROPERTY_FIELDS = [
  'propertyCode',
  'propertyName',
  'propertyType',
  'addressLine1',
  'addressLine2',
  'suburb',
  'city',
  'province',
  'postalCode',
  'grossLettableAreaSqm',
] as const satisfies readonly PortfolioImportFieldKey[]
const UNIT_FIELDS = ['unitNumber', 'unitType', 'floorAreaSqm', 'occupancyStatus'] as const satisfies readonly PortfolioImportFieldKey[]
export const TENANT_FIELDS = [
  'tenantTradingName',
  'tenantLegalName',
  'tenantRegistrationNumber',
  'tenantAccountReference',
  'tenantBusinessType',
  'tenantContactPerson',
  'tenantEmail',
  'tenantPhone',
] as const satisfies readonly PortfolioImportFieldKey[]
type PropertyField = (typeof PROPERTY_FIELDS)[number]
type UnitField = (typeof UNIT_FIELDS)[number]
const isUnitField = (field: PortfolioImportFieldKey): field is UnitField => (UNIT_FIELDS as readonly string[]).includes(field)
const isTenantField = (field: PortfolioImportFieldKey) => (TENANT_FIELDS as readonly string[]).includes(field)

/** Fields a new property or unit cannot be created without (the create forms' required fields). */
const REQUIRED_FOR_NEW_PROPERTY: readonly PropertyField[] = PROPERTY_FIELDS.filter((field) => field !== 'addressLine2')
const REQUIRED_FOR_NEW_UNIT: readonly UnitField[] = ['unitNumber', 'unitType', 'floorAreaSqm']

const HEADER = Object.fromEntries(PORTFOLIO_IMPORT_FIELDS.map((field) => [field.key, field.header])) as Record<PortfolioImportFieldKey, string>

/** A value as compared and reported: enum values, numbers in plain notation, text as written. */
type Value = string

// --------------------------------------------------------------------------- reading one cell

/**
 * The property and unit forms' own validation rules (the API's create schemas), field by field: an import row is held
 * to exactly what a person typing the record would be.
 */
const FIELD_SCHEMAS: Record<PortfolioImportFieldKey, z.ZodType> = {
  propertyCode: createPropertyBodySchema.shape.code,
  propertyName: createPropertyBodySchema.shape.name,
  propertyType: createPropertyBodySchema.shape.type,
  addressLine1: propertyAddressSchema.shape.line1,
  addressLine2: propertyAddressSchema.shape.line2,
  suburb: propertyAddressSchema.shape.suburb,
  city: propertyAddressSchema.shape.city,
  province: propertyAddressSchema.shape.province,
  postalCode: propertyAddressSchema.shape.postalCode,
  grossLettableAreaSqm: createPropertyBodySchema.shape.grossLettableAreaSqm,
  unitNumber: createUnitBodySchema.shape.unitNumber,
  unitType: createUnitBodySchema.shape.type,
  floorAreaSqm: createUnitBodySchema.shape.floorAreaSqm,
  occupancyStatus: createUnitBodySchema.shape.occupancyStatus,
  tenantTradingName: createTenantBodySchema.shape.tradingName,
  tenantLegalName: createTenantBodySchema.shape.legalName,
  tenantRegistrationNumber: createTenantBodySchema.shape.registrationNumber,
  tenantAccountReference: createTenantBodySchema.shape.accountReference,
  tenantBusinessType: createTenantBodySchema.shape.businessType,
  tenantContactPerson: tenantContactInputSchema.shape.fullName,
  tenantEmail: createTenantBodySchema.shape.email,
  tenantPhone: whatsappNumberSchema,
}

/** Text cells go to validation as written; the others are read into a LeaseGuard value first. */
const READERS: Partial<Record<PortfolioImportFieldKey, (text: string) => PortfolioCellReading<string | number>>> = {
  propertyType: readPortfolioPropertyType,
  province: readPortfolioProvince,
  postalCode: (text) => ({ ok: true, value: readPortfolioPostalCode(text) }),
  grossLettableAreaSqm: readPortfolioNumber,
  unitType: readPortfolioUnitType,
  floorAreaSqm: readPortfolioNumber,
  occupancyStatus: readPortfolioOccupancyStatus,
  tenantBusinessType: readPortfolioBusinessType,
  tenantPhone: readPortfolioTenantPhone,
}

const withHeader = (field: PortfolioImportFieldKey, message: string) =>
  /^[a-z]/.test(message) ? `${HEADER[field]} ${message}` : `${HEADER[field]}: ${message}`

/**
 * One cell read into the value the property or unit form would hold: an enum value, a number, or text (null for an
 * optional text that is empty). The problem is in words for people, prefixed with the field's template header.
 */
export function parsePortfolioField(field: PortfolioImportFieldKey, text: string): { value: unknown } | { problem: string } {
  const reading = READERS[field]?.(text) ?? { ok: true as const, value: text }
  if (!reading.ok) return { problem: withHeader(field, reading.message) }
  const checked = FIELD_SCHEMAS[field].safeParse(reading.value)
  if (!checked.success) return { problem: withHeader(field, checked.error.issues[0]?.message ?? 'is not valid') }
  return { value: checked.data }
}

function readCell(field: PortfolioImportFieldKey, text: string): { value: Value } | { problem: string } {
  const parsed = parsePortfolioField(field, text)
  return 'problem' in parsed ? parsed : { value: String(parsed.value ?? '') }
}

/**
 * The business type of a row's tenant: the business type column, else the one its registration number states (never
 * guessed otherwise). Takes the values as read by `parsePortfolioField`.
 */
export function tenantBusinessTypeOf(values: Partial<Record<PortfolioImportFieldKey, unknown>>): BusinessType | undefined {
  if (typeof values.tenantBusinessType === 'string') return values.tenantBusinessType as BusinessType
  return typeof values.tenantRegistrationNumber === 'string' ? businessTypeFromRegistrationNumber(values.tenantRegistrationNumber) : undefined
}

// --------------------------------------------------------------------------- comparing

const collapse = (text: string) => text.trim().replace(/\s+/g, ' ')
const sameValue = (field: PortfolioImportFieldKey, a: Value, b: Value) =>
  field === 'grossLettableAreaSqm' || field === 'floorAreaSqm' ? Number(a) === Number(b) : collapse(a) === collapse(b)

function propertyValue(property: ExistingProperty, field: PropertyField): Value {
  switch (field) {
    case 'propertyCode':
      return property.code
    case 'propertyName':
      return property.name
    case 'propertyType':
      return property.type
    case 'addressLine1':
      return property.addressLine1
    case 'addressLine2':
      return property.addressLine2 ?? ''
    case 'suburb':
      return property.suburb
    case 'city':
      return property.city
    case 'province':
      return property.province
    case 'postalCode':
      return property.postalCode
    case 'grossLettableAreaSqm':
      return String(property.grossLettableAreaSqm)
  }
}

function unitValue(unit: ExistingUnit, field: UnitField): Value {
  switch (field) {
    case 'unitNumber':
      return unit.unitNumber
    case 'unitType':
      return unit.type
    case 'floorAreaSqm':
      return String(unit.floorAreaSqm)
    case 'occupancyStatus':
      return unit.occupancyStatus
  }
}

/** Name plus street address and postal code, case and spacing ignored: the identity of a property without its code. */
const addressKey = (name: Value | undefined, line1: Value | undefined, postalCode: Value | undefined) =>
  name && line1 && postalCode ? [name, line1, postalCode].map((part) => collapse(part).toLowerCase()).join('\u0000') : undefined

// --------------------------------------------------------------------------- the row's tenant

/** A tenant the file adds: the first row naming it, and its name. */
interface FileTenant {
  rowNumber: number
  name: string
}

/** The company's tenants indexed for matching, and the new tenants of the rows checked so far. */
interface TenantIndex {
  byId: ReadonlyMap<EntityId, ExistingTenant>
  byRegistration: ReadonlyMap<string, ExistingTenant>
  byAccount: ReadonlyMap<string, ExistingTenant>
  all: readonly ExistingTenant[]
  fileByIdentifier: Map<string, FileTenant>
  fileByName: Map<string, FileTenant>
}

function tenantIndex(tenants: readonly ExistingTenant[]): TenantIndex {
  const byRegistration = new Map<string, ExistingTenant>()
  const byAccount = new Map<string, ExistingTenant>()
  for (const tenant of tenants) {
    if (tenant.registrationNumber) {
      const key = portfolioTenantIdentifierKey(tenant.registrationNumber)
      if (!byRegistration.has(key)) byRegistration.set(key, tenant)
    }
    if (tenant.accountReference) {
      const key = portfolioTenantIdentifierKey(tenant.accountReference)
      if (!byAccount.has(key)) byAccount.set(key, tenant)
    }
  }
  return { byId: new Map(tenants.map((tenant) => [tenant.id, tenant])), byRegistration, byAccount, all: tenants, fileByIdentifier: new Map(), fileByName: new Map() }
}

/** The most suggestions a row lists. */
const MAX_TENANT_SUGGESTIONS = 5

const suggestionOf = (tenant: ExistingTenant): PortfolioImportTenantSuggestion => ({
  id: tenant.id,
  tradingName: tenant.tradingName,
  legalName: tenant.legalName,
  ...(tenant.registrationNumber ? { registrationNumber: tenant.registrationNumber } : {}),
  ...(tenant.accountReference ? { accountReference: tenant.accountReference } : {}),
})

/** The contact details a row leaves empty. */
function missingTenantContactDetails(values: Partial<Record<PortfolioImportFieldKey, string>>): PortfolioImportTenantContactDetail[] {
  const missing: PortfolioImportTenantContactDetail[] = []
  if (!values.tenantContactPerson) missing.push('contactPerson')
  if (!values.tenantEmail) missing.push('email')
  if (!values.tenantPhone) missing.push('phone')
  return missing
}

/** What checking a row's tenant found: the tenant check, and what it adds to the row's problems and conflicts. */
interface TenantOutcome {
  check: PortfolioImportTenantCheck
  problems: string[]
  conflicts: PortfolioImportConflict[]
  /** Records the row's new tenant for the rows after it; called once the row is known to add it. */
  register?: () => void
}

/**
 * The row's tenant checked against the company's tenants and the earlier rows of the file. The strongest identifier
 * wins: the manager's confirmation, then an exact registration number or account reference (spaces and case ignored).
 * A tenant found by neither is new, unless tenants in LeaseGuard have a similar name: those are suggestions the
 * manager confirms or rejects, never a match on their own. Several rows naming the same new tenant by its identifier
 * create it once; rows naming a new tenant of the same name without any identifier are a conflict to resolve.
 */
function checkRowTenant(
  index: TenantIndex,
  input: {
    rowNumber: number
    values: Partial<Record<PortfolioImportFieldKey, string>>
    parsed: Partial<Record<PortfolioImportFieldKey, Value>>
    linkedTenant: ExistingTenant | undefined
    /** The tenant an earlier approval of the batch created from this row. */
    createdTenant: ExistingTenant | undefined
    rejected: boolean
    unitLabel: string
  },
): TenantOutcome {
  const { values, parsed, linkedTenant } = input
  const name = parsed.tenantTradingName ?? parsed.tenantLegalName ?? values.tenantTradingName ?? values.tenantLegalName ?? linkedTenant?.tradingName ?? ''
  const missingContactDetails = missingTenantContactDetails(values)
  const base = { name, suggestions: [] as PortfolioImportTenantSuggestion[], missingContactDetails }
  const none = { problems: [] as string[], conflicts: [] as PortfolioImportConflict[] }

  if (linkedTenant) {
    return {
      ...none,
      check: {
        ...base,
        name: linkedTenant.tradingName,
        missingContactDetails: [],
        result: 'match',
        matchedBy: 'confirmed',
        tenant: { id: linkedTenant.id, label: linkedTenant.tradingName },
        reasons: [`Confirmed as ${linkedTenant.tradingName} in LeaseGuard: no tenant is created and its details are kept`],
      },
    }
  }

  if (input.createdTenant) {
    return {
      ...none,
      check: {
        ...base,
        name: input.createdTenant.tradingName,
        missingContactDetails: [],
        result: 'match',
        matchedBy: 'createdByImport',
        tenant: { id: input.createdTenant.id, label: input.createdTenant.tradingName },
        reasons: [`${input.createdTenant.tradingName} was created from this row when the import was approved`],
      },
    }
  }

  const registration = parsed.tenantRegistrationNumber ? portfolioTenantIdentifierKey(parsed.tenantRegistrationNumber) : undefined
  const account = parsed.tenantAccountReference ? portfolioTenantIdentifierKey(parsed.tenantAccountReference) : undefined
  const byRegistration = registration ? index.byRegistration.get(registration) : undefined
  const byAccount = account ? index.byAccount.get(account) : undefined
  const conflict = (reason: string, conflicts: PortfolioImportConflict[]): TenantOutcome => ({
    problems: [],
    conflicts,
    check: { ...base, result: 'conflict', reasons: [reason] },
  })

  if (byRegistration && byAccount && byRegistration.id !== byAccount.id) {
    return conflict(
      `The registration number is ${byRegistration.tradingName}'s in LeaseGuard, but the account reference is ${byAccount.tradingName}'s`,
      [{ field: 'tenantAccountReference', value: parsed.tenantAccountReference ?? '', existingValue: byRegistration.accountReference ?? '' }],
    )
  }
  const found = byRegistration ?? byAccount
  if (found) {
    if (byRegistration && account && found.accountReference && portfolioTenantIdentifierKey(found.accountReference) !== account) {
      return conflict(`${found.tradingName} has this registration number in LeaseGuard, with another account reference`, [
        { field: 'tenantAccountReference', value: parsed.tenantAccountReference ?? '', existingValue: found.accountReference },
      ])
    }
    if (!byRegistration && registration && found.registrationNumber && portfolioTenantIdentifierKey(found.registrationNumber) !== registration) {
      return conflict(`${found.tradingName} has this account reference in LeaseGuard, with another registration number`, [
        { field: 'tenantRegistrationNumber', value: parsed.tenantRegistrationNumber ?? '', existingValue: found.registrationNumber },
      ])
    }
    return {
      ...none,
      check: {
        ...base,
        name: found.tradingName,
        result: 'match',
        matchedBy: byRegistration ? 'registrationNumber' : 'accountReference',
        tenant: { id: found.id, label: found.tradingName },
        reasons: [
          `${found.tradingName} is already in LeaseGuard with this ${byRegistration ? 'registration number' : 'account reference'}: no tenant is created and its details are kept`,
        ],
      },
    }
  }

  // ---- a tenant the file adds
  const identifiers = [registration && `registration:${registration}`, account && `account:${account}`].filter((key): key is string => Boolean(key))
  const earlier = identifiers.map((key) => index.fileByIdentifier.get(key)).find((tenant) => tenant !== undefined)
  if (earlier) {
    if (tenantNameKey(earlier.name) !== tenantNameKey(name)) {
      return conflict(`Row ${earlier.rowNumber} gives the tenant with this identifier another name`, [
        { field: 'tenantTradingName', value: name, existingValue: earlier.name, otherRowNumber: earlier.rowNumber },
      ])
    }
    return {
      ...none,
      check: { ...base, result: 'new', sameAsRowNumber: earlier.rowNumber, reasons: [`Same tenant as row ${earlier.rowNumber}: it is created once, from that row`] },
    }
  }
  const nameKey = tenantNameKey(name)
  const sameName = identifiers.length === 0 && nameKey ? index.fileByName.get(nameKey) : undefined
  if (sameName) {
    return conflict(
      `Row ${sameName.rowNumber} names a tenant of the same name: give both rows the tenant's registration number or account reference, or correct one name`,
      [{ field: 'tenantTradingName', value: name, existingValue: sameName.name, otherRowNumber: sameName.rowNumber }],
    )
  }

  const rowNames = [parsed.tenantTradingName, parsed.tenantLegalName].filter((text): text is string => Boolean(text))
  const similar = index.all.filter((tenant) => rowNames.some((text) => areSimilarTenantNames(text, tenant.tradingName) || areSimilarTenantNames(text, tenant.legalName)))
  const suggestions = similar.slice(0, MAX_TENANT_SUGGESTIONS).map(suggestionOf)
  if (suggestions.length > 0 && !input.rejected) {
    return {
      ...none,
      check: {
        ...base,
        suggestions,
        result: 'suggested',
        reasons: [
          `${suggestions.length === 1 ? 'A tenant' : `${suggestions.length} tenants`} in LeaseGuard ${suggestions.length === 1 ? 'has' : 'have'} a similar name but no registration number or account reference in common: confirm which tenant this is, or reject the suggestion`,
        ],
      },
    }
  }

  const problems: string[] = []
  if (!values.tenantLegalName) problems.push(`${HEADER.tenantLegalName} is missing`)
  if (!values.tenantContactPerson) problems.push(`${HEADER.tenantContactPerson} is missing: a tenant is created with its contact person`)
  if (!values.tenantPhone) problems.push(`${HEADER.tenantPhone} is missing: a tenant is created with its phone number`)
  if (!values.tenantBusinessType && !tenantBusinessTypeOf(parsed)) {
    problems.push(`${HEADER.tenantBusinessType} is missing, and the registration number does not state it`)
  }
  if (problems.length > 0) return { problems, conflicts: [], check: { ...base, suggestions, result: 'invalid', reasons: problems } }

  return {
    ...none,
    check: {
      ...base,
      suggestions,
      result: 'new',
      reasons: [
        input.rejected && suggestions.length > 0
          ? `Suggested tenants rejected: adds ${name} as a new tenant of ${input.unitLabel}`
          : `Adds the tenant ${name} to ${input.unitLabel}`,
      ],
    },
    register: () => {
      const tenant = { rowNumber: input.rowNumber, name }
      for (const key of identifiers) index.fileByIdentifier.set(key, tenant)
      if (identifiers.length === 0 && nameKey) index.fileByName.set(nameKey, tenant)
    },
  }
}

// --------------------------------------------------------------------------- checking every row

/** A property the file defines that is not in LeaseGuard yet: the first row naming it, and its values so far. */
interface FileProperty {
  rowNumber: number
  values: Partial<Record<PropertyField, Value>>
}

/**
 * Checks every row of a batch against the existing properties and units, in file order. Nothing is written.
 *
 * What the manager changed on a row comes first: a corrected value is read instead of the file's cell; a skipped row
 * is `skipped` and takes no part in the other rows' checks; a row linked to an existing property or unit stands for
 * that record, so nothing new is created for it and the file's values for it are neither validated nor compared.
 *
 * - A row is `invalid` when a mapped cell cannot be read or breaks the property, unit and tenant forms' rules, or a
 *   record it would create lacks a required value.
 * - A row with tenant values names its unit's tenant (see `checkRowTenant`): matched only by an exact registration
 *   number or account reference, or the manager's confirmation; a tenant with a similar name makes the row
 *   `suggested` until the manager confirms or rejects the suggestion.
 * - The property is found by its code first, then by its name together with its street address and postal code; a
 *   unit by its number within that property. Spelling and spacing that differ only in case count as the same; similar
 *   names never do.
 * - A row naming the same property and unit as an earlier row is a `duplicate` of it.
 * - A found record whose values differ from the row's is a `conflict`, with both values; so is a property the file
 *   gives different values on two rows.
 * - Otherwise the row is `new` when it adds a property or unit, and `match` when everything it names exists as it is.
 */
export function checkPortfolioRows(input: CheckRowsInput): PortfolioImportRowCheck[] {
  const byId = new Map(input.properties.map((property) => [property.id, property]))
  const unitsById = new Map(input.units.map((unit) => [unit.id, unit]))
  const scopeFields: ReadonlySet<PortfolioImportFieldKey> = new Set(portfolioImportFieldsFor(input.scope).map((field) => field.key))
  const byCode = new Map(input.properties.map((property) => [property.code.toUpperCase(), property]))
  const byAddress = new Map<string, ExistingProperty>()
  for (const property of input.properties) {
    const key = addressKey(property.name, property.addressLine1, property.postalCode)
    if (key && !byAddress.has(key)) byAddress.set(key, property)
  }
  const unitsByProperty = new Map<EntityId, Map<string, ExistingUnit>>()
  for (const unit of input.units) {
    const units = unitsByProperty.get(unit.propertyId) ?? new Map<string, ExistingUnit>()
    units.set(collapse(unit.unitNumber), unit)
    unitsByProperty.set(unit.propertyId, units)
  }
  const scopeProperty = input.scope === 'units' ? input.properties.find((property) => property.id === input.propertyId) : undefined
  const tenants = tenantIndex(input.tenants ?? [])
  const columnIndex = new Map(input.columns.map((column, index) => [column, index]))
  const mapped = (Object.keys(input.mapping) as PortfolioImportFieldKey[]).filter((field) => columnIndex.has(input.mapping[field] ?? ''))

  const fileProperties = new Map<string, FileProperty>()
  const seenRows = new Map<string, number>()

  return input.rows.map((row): PortfolioImportRowCheck => {
    const fileValues: Partial<Record<PortfolioImportFieldKey, string>> = {}
    for (const field of mapped) {
      const cell = row.cells[columnIndex.get(input.mapping[field] ?? '') ?? -1]?.trim()
      if (cell) fileValues[field] = cell
    }

    // ---- what the manager changed
    const stored = row.resolution
    const values = { ...fileValues }
    const corrections: PortfolioImportCorrection[] = []
    for (const field of PORTFOLIO_IMPORT_FIELDS.map((entry) => entry.key)) {
      const corrected = stored?.corrections[field]
      if (corrected === undefined || !scopeFields.has(field)) continue
      const value = corrected.trim()
      if (value) values[field] = value
      else delete values[field]
      const fileValue = fileValues[field]
      corrections.push({ field, value, ...(fileValue !== undefined ? { fileValue } : {}) })
    }
    const linkedProperty = input.scope === 'properties' && stored?.linkedPropertyId ? byId.get(stored.linkedPropertyId) : undefined
    const linkedUnitCandidate = stored?.linkedUnitId ? unitsById.get(stored.linkedUnitId) : undefined
    const linkedUnit =
      linkedUnitCandidate && linkedUnitCandidate.propertyId === (linkedProperty ?? scopeProperty)?.id ? linkedUnitCandidate : undefined
    const linkedTenant = stored?.linkedTenantId ? tenants.byId.get(stored.linkedTenantId) : undefined
    const tenantRejected = !linkedTenant && (stored?.tenantSuggestionsRejected ?? false)
    const resolution: PortfolioImportRowResolution | undefined =
      stored && (corrections.length > 0 || stored.skipped || linkedProperty || linkedUnit || linkedTenant || tenantRejected)
        ? {
            corrections,
            skipped: stored.skipped,
            ...(linkedProperty ? { linkedProperty: { id: linkedProperty.id, label: linkedProperty.name } } : {}),
            ...(linkedUnit ? { linkedUnit: { id: linkedUnit.id, label: linkedUnit.unitNumber } } : {}),
            ...(linkedTenant ? { linkedTenant: { id: linkedTenant.id, label: linkedTenant.tradingName } } : {}),
            tenantSuggestionsRejected: tenantRejected,
            ...(stored.changedByUserId ? { changedByUserId: stored.changedByUserId } : {}),
            changedAt: stored.changedAt ?? '',
          }
        : undefined

    const base = { rowNumber: row.rowNumber, values, conflicts: [] as PortfolioImportConflict[], ...(resolution ? { resolution } : {}) }
    if (stored?.skipped) return { ...base, result: 'skipped', reasons: ['Skipped: this row is left out of the import'] }
    let tenantCheck: PortfolioImportTenantCheck | undefined
    const invalid = (reasons: string[]): PortfolioImportRowCheck => ({ ...base, result: 'invalid', reasons, ...(tenantCheck ? { tenant: tenantCheck } : {}) })

    // The values of a linked record are not used, so they are neither read nor compared.
    const ignored = (field: PortfolioImportFieldKey) =>
      isTenantField(field)
        ? linkedTenant !== undefined
        : (linkedProperty !== undefined && !isUnitField(field)) || (linkedUnit !== undefined && isUnitField(field))
    const parsed: Partial<Record<PortfolioImportFieldKey, Value>> = {}
    const problems: string[] = []
    const tenantProblems: string[] = []
    for (const field of PORTFOLIO_IMPORT_FIELDS.map((entry) => entry.key)) {
      const text = values[field]
      if (text === undefined || ignored(field) || !scopeFields.has(field)) continue
      const cell = readCell(field, text)
      if ('problem' in cell) (isTenantField(field) ? tenantProblems : problems).push(cell.problem)
      else parsed[field] = cell.value
    }

    const hasProperty =
      input.scope === 'properties' && (linkedProperty !== undefined || PROPERTY_FIELDS.some((field) => values[field] !== undefined))
    const hasUnit = linkedUnit !== undefined || UNIT_FIELDS.some((field) => values[field] !== undefined)
    const hasTenant = linkedTenant !== undefined || TENANT_FIELDS.some((field) => values[field] !== undefined)
    if (!hasProperty && !hasUnit) return invalid(['The row has no values in the mapped columns'])
    if (input.scope === 'units' && !hasUnit) return invalid(['The row has no unit values'])
    if (input.scope === 'properties' && !hasProperty) return invalid(['The row names no property: fill in its code, or its name and address'])

    // ---- the property
    const conflicts: PortfolioImportConflict[] = []
    let existing: ExistingProperty | undefined
    let propertyKey: string
    let fileProperty: FileProperty | undefined
    if (scopeProperty ?? linkedProperty) {
      existing = scopeProperty ?? linkedProperty
      propertyKey = `id:${existing?.id ?? ''}`
    } else {
      const code = parsed.propertyCode
      const address = addressKey(parsed.propertyName, parsed.addressLine1, parsed.postalCode)
      const foundByAddress = address ? byAddress.get(address) : undefined
      existing = code ? byCode.get(code) : foundByAddress
      if (code && !existing && foundByAddress) {
        // The name and address are a property's, but the code is not: the same property with a different code.
        existing = foundByAddress
        conflicts.push({ field: 'propertyCode', value: code, existingValue: foundByAddress.code })
      }
      propertyKey = existing ? `id:${existing.id}` : code ? `code:${code}` : `address:${address ?? `row:${row.rowNumber}`}`
      if (!existing) fileProperty = fileProperties.get(propertyKey)
    }

    if (!existing && !fileProperty) {
      for (const field of REQUIRED_FOR_NEW_PROPERTY) if (values[field] === undefined) problems.push(`${HEADER[field]} is missing`)
    }

    // ---- the unit
    const unitNumber = linkedUnit?.unitNumber ?? parsed.unitNumber
    const existingUnit = linkedUnit ?? (existing && unitNumber ? unitsByProperty.get(existing.id)?.get(collapse(unitNumber)) : undefined)
    if (hasUnit && !existingUnit) {
      for (const field of REQUIRED_FOR_NEW_UNIT) if (values[field] === undefined) problems.push(`${HEADER[field]} is missing`)
    }
    if (existing?.status === 'archived' && hasUnit && !existingUnit) {
      problems.push(`${existing.name} is archived: restore it before importing units into it`)
    }

    // ---- the unit's tenant
    let tenantOutcome: TenantOutcome | undefined
    if (hasTenant) {
      if (!hasUnit) problems.push(`${HEADER.unitNumber} is missing: a tenant is imported with its unit`)
      const unitLabel = `unit ${unitNumber ?? ''} of ${existing?.name ?? (parsed.propertyCode ? `the property ${parsed.propertyCode}` : 'the property')}`.replace(/\s+/g, ' ')
      if (tenantProblems.length > 0) {
        tenantCheck = {
          result: 'invalid',
          reasons: tenantProblems,
          name: values.tenantTradingName ?? values.tenantLegalName ?? '',
          suggestions: [],
          missingContactDetails: missingTenantContactDetails(values),
        }
        problems.push(...tenantProblems)
      } else {
        const createdTenantId = input.createdTenants?.get(row.rowNumber)
        const createdTenant = createdTenantId ? tenants.byId.get(createdTenantId) : undefined
        tenantOutcome = checkRowTenant(tenants, { rowNumber: row.rowNumber, values, parsed, linkedTenant, createdTenant, rejected: tenantRejected, unitLabel })
        tenantCheck = tenantOutcome.check
        problems.push(...tenantOutcome.problems)
      }
    }
    const withTenant = tenantCheck ? { tenant: tenantCheck } : {}

    if (problems.length > 0) return invalid([...new Set(problems)])

    // ---- the same records as an earlier row
    const rowKey = `${propertyKey}\u0000${unitNumber ? collapse(unitNumber) : ''}`
    const earlier = seenRows.get(rowKey) ?? (!hasUnit ? fileProperty?.rowNumber : undefined)
    if (earlier !== undefined) {
      return {
        ...base,
        ...withTenant,
        result: 'duplicate',
        reasons: [`Row ${earlier} names the same ${hasUnit ? 'unit' : 'property'}`],
        duplicateOfRowNumber: earlier,
      }
    }
    seenRows.set(rowKey, row.rowNumber)

    // ---- values that differ
    if (input.scope === 'properties') {
      for (const field of PROPERTY_FIELDS) {
        const value = parsed[field]
        if (value === undefined || field === 'propertyCode') continue
        if (existing) {
          const other = propertyValue(existing, field)
          if (!sameValue(field, value, other)) conflicts.push({ field, value, existingValue: other })
        } else if (fileProperty) {
          const other = fileProperty.values[field]
          if (other === undefined) fileProperty.values[field] = value
          else if (!sameValue(field, value, other)) conflicts.push({ field, value, existingValue: other, otherRowNumber: fileProperty.rowNumber })
        }
      }
      if (!existing && !fileProperty) {
        const values: Partial<Record<PropertyField, Value>> = {}
        for (const field of PROPERTY_FIELDS) if (parsed[field] !== undefined) values[field] = parsed[field]
        fileProperties.set(propertyKey, { rowNumber: row.rowNumber, values })
      }
    }
    if (existingUnit) {
      for (const field of UNIT_FIELDS) {
        const value = parsed[field]
        if (value === undefined || field === 'unitNumber') continue
        const other = unitValue(existingUnit, field)
        if (!sameValue(field, value, other)) conflicts.push({ field, value, existingValue: other })
      }
    }

    const property: PortfolioImportMatchedRecord | undefined = existing ? { id: existing.id, label: existing.name } : undefined
    const unit: PortfolioImportMatchedRecord | undefined = existingUnit ? { id: existingUnit.id, label: existingUnit.unitNumber } : undefined
    const refs = { ...(property ? { property } : {}), ...(unit ? { unit } : {}) }
    const propertyLabel = existing ? existing.name : `the property ${parsed.propertyCode ?? parsed.propertyName ?? ''}`.trim()

    const tenantConflicts = tenantOutcome?.conflicts ?? []
    if (conflicts.length > 0 || tenantConflicts.length > 0) {
      const reasons = [
        ...conflicts.map((conflict) =>
          conflict.otherRowNumber !== undefined
            ? `${HEADER[conflict.field]} differs from row ${conflict.otherRowNumber}`
            : `${HEADER[conflict.field]} differs from ${isUnitField(conflict.field) ? `unit ${existingUnit?.unitNumber ?? ''} of ${propertyLabel}` : propertyLabel} in LeaseGuard`,
        ),
        ...(tenantConflicts.length > 0 ? (tenantCheck?.reasons ?? []) : []),
      ]
      return { ...base, ...refs, ...withTenant, conflicts: [...conflicts, ...tenantConflicts], result: 'conflict', reasons }
    }
    if (tenantCheck?.result === 'suggested') {
      return { ...base, ...refs, ...withTenant, result: 'suggested', reasons: tenantCheck.reasons }
    }

    // ---- what the row adds, or the records it names as they are
    let records: { result: 'new' | 'match'; reason: string }
    if (!existing) {
      const defined = fileProperty ? ` (first named in row ${fileProperty.rowNumber})` : ''
      records = {
        result: 'new',
        reason: fileProperty
          ? `Adds the unit ${unitNumber ?? ''} to the new property ${parsed.propertyCode ?? ''}${defined}`.replace(/\s+/g, ' ')
          : hasUnit
            ? `Adds ${propertyLabel} with the unit ${unitNumber ?? ''}`
            : `Adds ${propertyLabel}`,
      }
    } else if (hasUnit && !existingUnit) {
      records = { result: 'new', reason: `Adds the unit ${unitNumber ?? ''} to ${existing.name}` }
    } else {
      const linked = linkedUnit ?? linkedProperty
      records = {
        result: 'match',
        reason: linked
          ? `Linked to ${existingUnit ? `unit ${existingUnit.unitNumber} of ${existing.name}` : existing.name} in LeaseGuard: nothing new is created for it`
          : existingUnit
            ? `Unit ${existingUnit.unitNumber} of ${existing.name} is already in LeaseGuard with these values`
            : `${existing.name} is already in LeaseGuard with these values`,
      }
    }
    tenantOutcome?.register?.()
    const addsTenant = tenantCheck?.result === 'new' && tenantCheck.sameAsRowNumber === undefined
    return {
      ...base,
      ...refs,
      ...withTenant,
      result: records.result === 'new' || addsTenant ? 'new' : 'match',
      reasons: [records.reason, ...(tenantCheck?.reasons ?? [])],
    }
  })
}
