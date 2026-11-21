import type { PortfolioImportFieldKey, PortfolioImportScope } from '../types/index.js'

/** What a portfolio import column describes. */
export type PortfolioImportFieldRecord = 'property' | 'unit' | 'tenant'

/** One column LeaseGuard reads from a portfolio file. */
export interface PortfolioImportField {
  /** Stable key, used by column mappings. */
  key: PortfolioImportFieldKey
  record: PortfolioImportFieldRecord
  /** The column heading in LeaseGuard's template. */
  header: string
  /** Example value for the template's example row. */
  example: string
}

/**
 * Every column a portfolio import supports, in template order: the property's identity, type, address and gross
 * lettable area, then the unit's number, type, floor area and occupancy status, then the unit's tenant (optional: a
 * file without tenant columns imports properties and units only).
 */
export const PORTFOLIO_IMPORT_FIELDS: readonly PortfolioImportField[] = [
  { key: 'propertyCode', record: 'property', header: 'Property code', example: 'MSQ' },
  { key: 'propertyName', record: 'property', header: 'Property name', example: 'Market Square' },
  { key: 'propertyType', record: 'property', header: 'Property type', example: 'Shopping centre' },
  { key: 'addressLine1', record: 'property', header: 'Address line 1', example: '12 Main Road' },
  { key: 'addressLine2', record: 'property', header: 'Address line 2', example: '' },
  { key: 'suburb', record: 'property', header: 'Suburb', example: 'Rosebank' },
  { key: 'city', record: 'property', header: 'City', example: 'Johannesburg' },
  { key: 'province', record: 'property', header: 'Province', example: 'Gauteng' },
  { key: 'postalCode', record: 'property', header: 'Postal code', example: '2196' },
  { key: 'grossLettableAreaSqm', record: 'property', header: 'Gross lettable area (m²)', example: '12500' },
  { key: 'unitNumber', record: 'unit', header: 'Unit number', example: 'Shop 12' },
  { key: 'unitType', record: 'unit', header: 'Unit type', example: 'Line shop' },
  { key: 'floorAreaSqm', record: 'unit', header: 'Floor area (m²)', example: '145.5' },
  { key: 'occupancyStatus', record: 'unit', header: 'Unit status', example: 'Occupied' },
  { key: 'tenantTradingName', record: 'tenant', header: 'Tenant trading name', example: 'Bean There Coffee' },
  { key: 'tenantLegalName', record: 'tenant', header: 'Tenant registered name', example: 'Bean There Coffee (Pty) Ltd' },
  { key: 'tenantRegistrationNumber', record: 'tenant', header: 'Tenant registration number', example: '2015/123456/07' },
  { key: 'tenantAccountReference', record: 'tenant', header: 'Tenant account reference', example: 'MSQ-T012' },
  { key: 'tenantBusinessType', record: 'tenant', header: 'Tenant business type', example: 'Pty Ltd' },
  { key: 'tenantContactPerson', record: 'tenant', header: 'Tenant contact person', example: 'Thandi Mokoena' },
  { key: 'tenantEmail', record: 'tenant', header: 'Tenant email', example: 'accounts@beanthere.co.za' },
  { key: 'tenantPhone', record: 'tenant', header: 'Tenant phone', example: '082 123 4567' },
]

/**
 * The columns a template for `scope` lists: every column for properties with their units; only the unit and tenant
 * columns for units of one property (the property is the one the import was started from).
 */
export function portfolioImportFieldsFor(scope: PortfolioImportScope): readonly PortfolioImportField[] {
  return scope === 'units' ? PORTFOLIO_IMPORT_FIELDS.filter((field) => field.record !== 'property') : PORTFOLIO_IMPORT_FIELDS
}

/** A CSV field, quoted only when it holds a comma, quote or line break. */
function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/**
 * The downloadable CSV template for `scope`: a heading row listing every supported column and one example row,
 * comma-separated with CRLF line ends, as spreadsheet programs write CSV. The caller adds a byte-order mark when the
 * file is for Excel, so the m² headings read correctly.
 */
export function portfolioImportTemplateCsv(scope: PortfolioImportScope): string {
  const fields = portfolioImportFieldsFor(scope)
  return [fields.map((field) => csvField(field.header)), fields.map((field) => csvField(field.example))].map((row) => row.join(',')).join('\r\n') + '\r\n'
}
