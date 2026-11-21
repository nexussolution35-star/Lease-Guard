import type {
  BusinessType,
  OccupancyStatus,
  PortfolioImportColumnMapping,
  PortfolioImportFieldKey,
  PortfolioImportScope,
  PropertyType,
  SAProvince,
  UnitType,
} from '../types/index.js'
import { portfolioImportFieldsFor } from './portfolioImportTemplate.js'
import { normalizeWhatsAppNumber } from './whatsappNumber.js'

/**
 * A heading reduced to what identifies it: lower case, accents dropped, `²` read as `2`, `&` as `and`, `#` as `no`,
 * then letters and digits only, with a trailing area unit (`m2`, `sqm`, `square metres`) removed. "Floor area (m²)",
 * "FLOOR_AREA" and "Floor Area sqm" all become `floorarea`.
 */
export function normalizePortfolioHeader(heading: string): string {
  const compact = heading
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/²/g, '2')
    .replace(/&/g, 'and')
    .replace(/#/g, 'no')
    .replace(/[^a-z0-9]/g, '')
  const withoutUnit = compact.replace(/(m2|sqm|sqmetres|sqmeters|squaremetres|squaremeters)$/, '')
  return withoutUnit === '' ? compact : withoutUnit
}

/**
 * Headings recognised for each field, besides LeaseGuard's own template headings: the usual wording, and the column
 * names in rent-roll and property exports from MRI (BLDGID, SUITID, Suite Area), MDA (Prop Code, Unit No, Unit Size),
 * PropSys (Property Code, Unit Code, Unit Area) and Sage (Property, Unit, Area); and the tenant register columns of
 * the same systems (MRI Occupant ID / Occupant Name, MDA Tenant Code, Sage Customer Code / Debtor Code). Matching is on
 * the normalised heading only, never on the values in the rows.
 */
export const PORTFOLIO_IMPORT_HEADER_SYNONYMS: Readonly<Record<PortfolioImportFieldKey, readonly string[]>> = {
  propertyCode: [
    'Property code', 'Prop code', 'Property ID', 'Prop ID', 'Property no', 'Property number', 'Property ref', 'Property reference',
    'Building code', 'Building ID', 'Bldg ID', 'BLDGID', 'Bldg code', 'Entity ID', 'ENTITYID', 'Site code', 'Centre code', 'Center code',
    'Property key',
  ],
  propertyName: [
    'Property name', 'Prop name', 'Property', 'Property description', 'Prop description', 'Building name', 'Bldg name', 'Building',
    'Centre name', 'Center name', 'Centre', 'Site name', 'Entity name',
  ],
  propertyType: ['Property type', 'Prop type', 'Building type', 'Bldg type', 'Property category', 'Property class', 'Asset type', 'Property use', 'Sector'],
  addressLine1: [
    'Address line 1', 'Address 1', 'Address1', 'Addr1', 'Address', 'Street address', 'Street', 'Physical address', 'Property address',
    'Building address',
  ],
  addressLine2: ['Address line 2', 'Address 2', 'Address2', 'Addr2'],
  suburb: ['Suburb', 'Locality', 'District', 'Township'],
  city: ['City', 'Town', 'City / town', 'Town / city', 'City or town'],
  province: ['Province', 'Prov', 'Region', 'State'],
  postalCode: ['Postal code', 'Postcode', 'Post code', 'Postal', 'Zip', 'Zip code'],
  grossLettableAreaSqm: [
    'Gross lettable area', 'GLA', 'Property GLA', 'Building GLA', 'Total GLA', 'Bldg GLA', 'Gross leasable area', 'Lettable area',
    'Leasable area', 'Rentable area', 'Building area', 'Bldg area', 'Property area', 'Total area',
  ],
  unitNumber: [
    'Unit number', 'Unit no', 'Unit', 'Unit ID', 'Unit code', 'Unit ref', 'Unit reference', 'Suite', 'Suite ID', 'SUITID', 'Suite no',
    'Suite number', 'Shop', 'Shop no', 'Shop number', 'Premises', 'Premises no', 'Space', 'Space no', 'Space ID', 'Door no',
  ],
  unitType: ['Unit type', 'Suite type', 'Space type', 'Shop type', 'Premises type', 'Unit category', 'Unit use', 'Usage', 'Use type'],
  floorAreaSqm: [
    'Floor area', 'Unit area', 'Unit size', 'Unit GLA', 'Suite area', 'Suite size', 'Space area', 'Shop area', 'Premises area',
    'Area', 'Size',
  ],
  occupancyStatus: [
    'Unit status', 'Status', 'Occupancy', 'Occupancy status', 'Occupied', 'Vacancy', 'Vacancy status', 'Let status', 'Lease status',
    'Suite status', 'Space status',
  ],
  tenantTradingName: [
    'Tenant', 'Tenant name', 'Trading name', 'Trading as', 'T/A', 'Lessee', 'Lessee name', 'Occupant', 'Occupant name', 'OCCPNAME',
    'Customer name', 'Debtor name',
  ],
  tenantLegalName: [
    'Registered name', 'Legal name', 'Company name', 'Registered company name', 'Tenant legal name', 'Tenant registered name',
    'Lessee legal name', 'Lessee registered name',
  ],
  tenantRegistrationNumber: [
    'Registration number', 'Registration no', 'Reg no', 'Reg number', 'Company registration number', 'Company reg no',
    'Company registration no', 'CIPC number', 'CIPC no', 'CK number', 'Company number',
  ],
  tenantAccountReference: [
    'Account reference', 'Account ref', 'Account no', 'Account number', 'Account code', 'Tenant code', 'Tenant ID', 'Tenant no',
    'Tenant number', 'Tenant ref', 'Tenant reference', 'Tenant account', 'Tenant account no', 'Debtor code', 'Debtor account',
    'Debtor no', 'Customer code', 'Customer account', 'Customer no', 'Occupant ID', 'OCCPID',
  ],
  tenantBusinessType: ['Business type', 'Entity type', 'Company type', 'Legal entity type', 'Tenant type', 'Tenant entity type'],
  tenantContactPerson: ['Contact person', 'Contact name', 'Contact', 'Tenant contact', 'Primary contact', 'Contact full name'],
  tenantEmail: ['Email', 'E-mail', 'Email address', 'Contact email', 'Tenant email address', 'Accounts email'],
  tenantPhone: [
    'Phone', 'Phone number', 'Telephone', 'Tel', 'Tel no', 'Cell', 'Cell no', 'Cellphone', 'Cell number', 'Mobile', 'Mobile number',
    'Contact number', 'Contact phone', 'WhatsApp', 'WhatsApp number', 'Tenant phone number', 'Tenant cell', 'Tenant mobile',
  ],
}

/**
 * Importing units of one property, the file has no property columns, so the area headings that otherwise name the
 * property's gross lettable area name the unit's floor area.
 */
const UNITS_SCOPE_SYNONYMS: Readonly<Partial<Record<PortfolioImportFieldKey, readonly string[]>>> = {
  floorAreaSqm: ['Gross lettable area', 'GLA', 'Lettable area', 'Leasable area', 'Rentable area', 'Gross leasable area', 'Total area'],
}

/** Normalised heading → field, for one scope. */
function headingIndex(scope: PortfolioImportScope): ReadonlyMap<string, PortfolioImportFieldKey> {
  const index = new Map<string, PortfolioImportFieldKey>()
  const add = (field: PortfolioImportFieldKey, heading: string) => {
    const key = normalizePortfolioHeader(heading)
    if (!index.has(key)) index.set(key, field)
  }
  for (const field of portfolioImportFieldsFor(scope)) {
    add(field.key, field.header)
    add(field.key, field.key)
    for (const heading of UNITS_SCOPE_SYNONYMS[field.key] ?? []) if (scope === 'units') add(field.key, heading)
    for (const heading of PORTFOLIO_IMPORT_HEADER_SYNONYMS[field.key]) add(field.key, heading)
  }
  return index
}

const HEADING_INDEX: Readonly<Record<PortfolioImportScope, ReadonlyMap<string, PortfolioImportFieldKey>>> = {
  properties: headingIndex('properties'),
  units: headingIndex('units'),
}

/** Every heading recognised for `field` in `scope`, normalised (for tests and documentation). */
export function portfolioImportRecognisedHeadings(scope: PortfolioImportScope, field: PortfolioImportFieldKey): string[] {
  return [...HEADING_INDEX[scope]].filter(([, target]) => target === field).map(([heading]) => heading)
}

/**
 * The mapping suggested for a file's headings: each column whose normalised heading is a recognised heading of a field
 * of `scope` is read for that field. Columns are taken in file order, so when two columns fit the same field the first
 * one wins. Only the headings are looked at: the same headings always give the same mapping.
 */
export function suggestPortfolioImportMapping(columns: readonly string[], scope: PortfolioImportScope): PortfolioImportColumnMapping {
  const mapping: PortfolioImportColumnMapping = {}
  for (const column of columns) {
    const field = HEADING_INDEX[scope].get(normalizePortfolioHeader(column))
    if (field && mapping[field] === undefined) mapping[field] = column
  }
  return mapping
}

/**
 * What identifies a file's headings when a saved mapping is looked up: the headings trimmed and in lower case, in file
 * order, joined by a unit separator. The API stores a hash of it.
 */
export function portfolioImportHeaderSignature(columns: readonly string[]): string {
  return columns.map((column) => column.trim().toLowerCase()).join('\u001f')
}

/**
 * Why a mapping cannot be applied to a batch with these columns and scope: a field that is not imported in this scope,
 * a column the file does not have, or a column read for two fields. Empty when it can be applied.
 */
export function portfolioImportMappingProblems(
  mapping: PortfolioImportColumnMapping,
  columns: readonly string[],
  scope: PortfolioImportScope,
): string[] {
  const allowed = new Map(portfolioImportFieldsFor(scope).map((field) => [field.key as string, field.header]))
  const problems: string[] = []
  const usedBy = new Map<string, string>()
  for (const [field, column] of Object.entries(mapping)) {
    if (column === undefined) continue
    const header = allowed.get(field)
    if (!header) {
      problems.push(`${field} is not imported ${scope === 'units' ? 'with units of one property' : 'here'}`)
      continue
    }
    if (!columns.includes(column)) {
      problems.push(`The file has no column "${column}"`)
      continue
    }
    const other = usedBy.get(column)
    if (other) problems.push(`The column "${column}" is chosen for both ${other} and ${header}`)
    else usedBy.set(column, header)
  }
  return problems
}

/** Only the entries of `mapping` that can be applied to these columns and scope (a saved mapping read back). */
export function applicablePortfolioImportMapping(
  mapping: PortfolioImportColumnMapping,
  columns: readonly string[],
  scope: PortfolioImportScope,
): PortfolioImportColumnMapping {
  const allowed = new Set<string>(portfolioImportFieldsFor(scope).map((field) => field.key))
  const used = new Set<string>()
  const result: PortfolioImportColumnMapping = {}
  for (const field of portfolioImportFieldsFor(scope)) {
    const column = mapping[field.key]
    if (column === undefined || !allowed.has(field.key) || !columns.includes(column) || used.has(column)) continue
    used.add(column)
    result[field.key] = column
  }
  return result
}

// --------------------------------------------------------------------------- reading values

/** A cell read as a LeaseGuard value, or why it could not be. */
export type PortfolioCellReading<T> = { ok: true; value: T } | { ok: false; message: string }

const read = <T>(value: T): PortfolioCellReading<T> => ({ ok: true, value })
const unreadable = <T>(message: string): PortfolioCellReading<T> => ({ ok: false, message })

/** Lower case, letters and digits only: how enum labels are compared. */
const labelKey = (text: string) =>
  text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')

function labelReader<T extends string>(labels: Readonly<Record<T, readonly string[]>>, describe: (text: string) => string) {
  const index = new Map<string, T>()
  for (const [value, words] of Object.entries(labels) as [T, readonly string[]][]) {
    index.set(labelKey(value), value)
    for (const word of words) index.set(labelKey(word), value)
  }
  return (text: string): PortfolioCellReading<T> => {
    const value = index.get(labelKey(text))
    return value ? read(value) : unreadable(describe(text))
  }
}

/** A property type from its LeaseGuard label ("Shopping centre"), its value (`shopping_centre`) or a usual synonym. */
export const readPortfolioPropertyType = labelReader<PropertyType>(
  {
    shopping_centre: ['Shopping centre', 'Shopping center', 'Shopping mall', 'Mall', 'Centre'],
    retail: ['Retail', 'Retail property'],
    office: ['Office', 'Offices', 'Office building', 'Office park', 'Commercial office'],
    industrial_warehouse: ['Industrial / warehouse', 'Industrial', 'Warehouse', 'Industrial warehouse', 'Industrial park', 'Logistics'],
    mixed_use: ['Mixed use', 'Mixed-use'],
  },
  (text) => `"${text}" is not a property type: use Shopping centre, Retail, Office, Industrial / warehouse or Mixed use`,
)

/** A unit type from its LeaseGuard label ("Line shop"), its value (`line_shop`) or a usual synonym. */
export const readPortfolioUnitType = labelReader<UnitType>(
  {
    anchor_retail: ['Anchor retail', 'Anchor', 'Anchor tenant', 'Anchor store'],
    line_shop: ['Line shop', 'Shop', 'Retail shop', 'Retail'],
    kiosk: ['Kiosk'],
    restaurant: ['Restaurant', 'Food', 'Food and beverage', 'Restaurant / food'],
    office_suite: ['Office suite', 'Office', 'Offices'],
    warehouse: ['Warehouse', 'Industrial unit', 'Industrial'],
    yard: ['Yard'],
    storage: ['Storage', 'Store room', 'Storeroom'],
    parking: ['Parking', 'Parking bay'],
  },
  (text) =>
    `"${text}" is not a unit type: use Anchor retail, Line shop, Kiosk, Restaurant, Office suite, Warehouse, Yard, Storage or Parking`,
)

/** A unit's occupancy status from its LeaseGuard label ("Under offer"), its value or a usual synonym. */
export const readPortfolioOccupancyStatus = labelReader<OccupancyStatus>(
  {
    occupied: ['Occupied', 'Let', 'Leased', 'Tenanted'],
    vacant: ['Vacant', 'Empty', 'Available'],
    under_offer: ['Under offer'],
    unavailable: ['Unavailable', 'Not available', 'Not lettable'],
  },
  (text) => `"${text}" is not a unit status: use Occupied, Vacant, Under offer or Unavailable`,
)

const PROVINCE_ABBREVIATIONS: Readonly<Record<SAProvince, readonly string[]>> = {
  'Eastern Cape': ['EC'],
  'Free State': ['FS'],
  Gauteng: ['GP', 'GT', 'GAU'],
  'KwaZulu-Natal': ['KZN', 'KN'],
  Limpopo: ['LP', 'LIM'],
  Mpumalanga: ['MP', 'MPU'],
  'North West': ['NW'],
  'Northern Cape': ['NC'],
  'Western Cape': ['WC'],
}

/** A tenant's business type from its LeaseGuard label ("Pty Ltd"), its value (`pty_ltd`) or a usual synonym. */
export const readPortfolioBusinessType = labelReader<BusinessType>(
  {
    pty_ltd: ['Pty Ltd', '(Pty) Ltd', 'Pty', 'Private company', 'Proprietary limited', 'Private company (Pty) Ltd'],
    close_corporation: ['Close corporation', 'CC'],
    sole_proprietor: ['Sole proprietor', 'Sole proprietorship', 'Sole trader'],
    partnership: ['Partnership'],
    npc: ['NPC', 'Non-profit company', 'Nonprofit company', 'Not for profit company'],
    franchise: ['Franchise', 'Franchisee'],
  },
  (text) => `"${text}" is not a business type: use Pty Ltd, Close corporation, Sole proprietor, Partnership, NPC or Franchise`,
)

/**
 * The business type a South African company registration number states: CIPC numbers are `YYYY/NNNNNN/TT`, where the
 * entity code TT is 07 for a private company (Pty) Ltd, 23 for a close corporation and 08 for a non-profit company.
 * Undefined for any other code or format: the business type is then never guessed.
 */
export function businessTypeFromRegistrationNumber(registrationNumber: string): BusinessType | undefined {
  const match = /^[0-9]{4}\/[0-9]{6}\/([0-9]{2})$/.exec(registrationNumber.replace(/\s/g, ''))
  switch (match?.[1]) {
    case '07':
      return 'pty_ltd'
    case '23':
      return 'close_corporation'
    case '08':
      return 'npc'
    default:
      return undefined
  }
}

/**
 * A tenant's phone number from a register, in the E.164 form LeaseGuard stores (`082 123 4567` → `+27821234567`). Only
 * South African numbers are read: anything else is refused with the format to use.
 */
export function readPortfolioTenantPhone(text: string): PortfolioCellReading<string> {
  const result = normalizeWhatsAppNumber(text)
  if (!result.ok) return unreadable(`"${text}" is not a South African phone number: write it as 082 123 4567 or +27 82 123 4567`)
  if (!result.number.startsWith('+27')) return unreadable(`"${text}" is not a South African phone number: write it as 082 123 4567 or +27 82 123 4567`)
  return read(result.number)
}

/**
 * What identifies a tenant's registration number or account reference when matching: upper case, without spaces.
 * `2015/123456/07` and `2015 / 123456 / 07` are the same number; anything else must be written the same.
 */
export function portfolioTenantIdentifierKey(text: string): string {
  return text.replace(/\s/g, '').toUpperCase()
}

/** A South African province from its name (any case, with or without the hyphen) or its usual abbreviation (GP, KZN). */
export const readPortfolioProvince = labelReader<SAProvince>(PROVINCE_ABBREVIATIONS, (text) => `"${text}" is not a South African province`)

/**
 * A postal code as text. Spreadsheets drop the leading zero of codes such as 0181 when the column holds numbers, so
 * three digits are read with the zero put back; anything else is kept as written for validation to judge.
 */
export function readPortfolioPostalCode(text: string): string {
  const trimmed = text.trim()
  return /^[0-9]{3}$/.test(trimmed) ? `0${trimmed}` : trimmed
}

/**
 * An area or other figure written the way South African spreadsheets write it: `12500`, `12 500`, `145.5`, `145,5`,
 * `12 500,75`, `12,500.75` or `12.500,75`, optionally followed by `m²`, `m2` or `sqm`. A single separator followed by
 * exactly three digits (`12,500` or `12.500`) could be a thousands separator or a decimal one, so it is refused rather
 * than guessed.
 */
export function readPortfolioNumber(text: string): PortfolioCellReading<number> {
  const compact = text.replace(/[\s  ]/g, '').replace(/(m²|m2|sqm)$/i, '')
  const notANumber = unreadable<number>(`"${text}" is not a number`)
  if (!/^[0-9.,]+$/.test(compact) || !/[0-9]/.test(compact)) return notANumber

  const commas = compact.split(',').length - 1
  const dots = compact.split('.').length - 1
  let plain: string
  if (commas > 0 && dots > 0) {
    const decimal = compact.lastIndexOf(',') > compact.lastIndexOf('.') ? ',' : '.'
    const thousands = decimal === ',' ? '.' : ','
    const [whole = '', fraction = '', ...rest] = compact.split(decimal)
    if (rest.length > 0 || !isGrouped(whole, thousands)) return notANumber
    plain = `${whole.split(thousands).join('')}.${fraction}`
  } else if (commas + dots > 1) {
    const separator = commas > 0 ? ',' : '.'
    if (!isGrouped(compact, separator)) return notANumber
    plain = compact.split(separator).join('')
  } else if (commas + dots === 1) {
    const separator = commas > 0 ? ',' : '.'
    const [whole = '', fraction = ''] = compact.split(separator)
    if (/^[1-9][0-9]{0,2}$/.test(whole) && /^[0-9]{3}$/.test(fraction)) {
      return unreadable(`"${text}" is unclear: write ${whole}${fraction} (or ${whole} ${fraction}) for thousands, or use at most two decimals`)
    }
    plain = `${whole}.${fraction}`
  } else {
    plain = compact
  }
  if (!/^[0-9]*\.?[0-9]*$/.test(plain) || plain === '.') return notANumber
  const value = Number(plain)
  return Number.isFinite(value) ? read(value) : notANumber
}

/** `12,500,000` style: a 1–3 digit group, then groups of exactly three digits. */
function isGrouped(whole: string, separator: string): boolean {
  const groups = whole.split(separator)
  return groups.length === 1 ? /^[0-9]+$/.test(whole) : /^[1-9][0-9]{0,2}$/.test(groups[0] ?? '') && groups.slice(1).every((group) => /^[0-9]{3}$/.test(group))
}
