import { PORTFOLIO_IMPORT_FIELDS, suggestPortfolioImportMapping } from '@leaseguard/domain'
import { describe, expect, it } from 'vitest'

import {
  checkPortfolioRows,
  type CheckRowsInput,
  type ExistingProperty,
  type ExistingTenant,
  type ExistingUnit,
  type StoredRowResolution,
} from './check-rows'

const MSQ: ExistingProperty = {
  id: 'p-msq',
  code: 'MSQ',
  name: 'Market Square',
  type: 'shopping_centre',
  status: 'active',
  addressLine1: '12 Main Road',
  addressLine2: null,
  suburb: 'Rosebank',
  city: 'Johannesburg',
  province: 'Gauteng',
  postalCode: '2196',
  grossLettableAreaSqm: 12500,
}
const SHOP_12: ExistingUnit = { id: 'u-12', propertyId: 'p-msq', unitNumber: 'Shop 12', type: 'line_shop', floorAreaSqm: 145.5, occupancyStatus: 'occupied' }

const COLUMNS = PORTFOLIO_IMPORT_FIELDS.map((field) => field.header)
const MAPPING = suggestPortfolioImportMapping(COLUMNS, 'properties')
const MSQ_CELLS = ['MSQ', 'Market Square', 'Shopping centre', '12 Main Road', '', 'Rosebank', 'Johannesburg', 'Gauteng', '2196', '12500']
const NEW_CELLS = ['KGP', 'Kgalagadi Park', 'Retail', '1 Desert Road', '', 'Upington', 'Upington', 'Northern Cape', '8801', '4 000']

const row = (rowNumber: number, cells: string[], resolution?: Partial<StoredRowResolution>) => ({
  rowNumber,
  cells,
  ...(resolution ? { resolution: { corrections: {}, skipped: false, changedByUserId: 'user-naledi', changedAt: '2026-11-21T08:00:00Z', ...resolution } } : {}),
})
const check = (rows: ReturnType<typeof row>[], overrides: Partial<CheckRowsInput> = {}) =>
  checkPortfolioRows({ scope: 'properties', columns: COLUMNS, mapping: MAPPING, rows, properties: [MSQ], units: [SHOP_12], ...overrides })

describe('checkPortfolioRows', () => {
  it('marks a re-uploaded row of an existing property and unit as matching, not new', () => {
    const [result] = check([row(2, [...MSQ_CELLS, 'Shop 12', 'Line shop', '145,5', 'Let'])])
    expect(result).toMatchObject({
      rowNumber: 2,
      result: 'match',
      conflicts: [],
      property: { id: 'p-msq', label: 'Market Square' },
      unit: { id: 'u-12', label: 'Shop 12' },
    })
  })

  it('adds a new property with its units; later rows of the property only need its code', () => {
    const results = check([
      row(2, [...NEW_CELLS, 'Shop 1', 'Line shop', '80', 'Vacant']),
      row(3, ['KGP', '', '', '', '', '', '', '', '', '', 'Shop 2', 'Kiosk', '12', '']),
    ])
    expect(results.map((r) => r.result)).toEqual(['new', 'new'])
    expect(results[0]!.reasons).toEqual(['Adds the property KGP with the unit Shop 1'])
    expect(results[1]!.reasons[0]).toMatch(/first named in row 2/)
  })

  it('adds a unit to an existing property found by its code', () => {
    const [result] = check([row(2, ['MSQ', '', '', '', '', '', '', '', '', '', 'Shop 14', 'Restaurant', '210', 'Vacant'])])
    expect(result).toMatchObject({ result: 'new', property: { id: 'p-msq' }, reasons: ['Adds the unit Shop 14 to Market Square'] })
  })

  it('finds a property without a code by its name and address, but never by a similar name', () => {
    const noCode = { ...MAPPING }
    delete noCode.propertyCode
    const [same, similar] = check(
      [
        row(2, ['', 'MARKET  square', 'Shopping centre', '12 Main Road', '', 'Rosebank', 'Johannesburg', 'Gauteng', '2196', '12500', '', '', '', '']),
        row(3, ['', 'Market Square Mall', 'Shopping centre', '12 Main Road', '', 'Rosebank', 'Johannesburg', 'Gauteng', '2196', '12500', '', '', '', '']),
      ],
      { mapping: noCode },
    )
    // Same name in other case: found, but the name as written differs from the record, so both values are shown.
    expect(same).toMatchObject({ result: 'conflict', property: { id: 'p-msq' } })
    expect(same!.conflicts).toEqual([{ field: 'propertyName', value: 'MARKET  square', existingValue: 'Market Square' }])
    // A similar name is another property, which needs a code to be created.
    expect(similar).toMatchObject({ result: 'invalid', reasons: ['Property code is missing'] })
  })

  it('marks a matching code with other values as a conflict and shows both values', () => {
    const cells = [...MSQ_CELLS]
    cells[2] = 'Office'
    cells[9] = '13 000'
    const [result] = check([row(2, [...cells, 'Shop 12', 'Kiosk', '145.5', 'Occupied'])])
    expect(result!.result).toBe('conflict')
    expect(result!.conflicts).toEqual([
      { field: 'propertyType', value: 'office', existingValue: 'shopping_centre' },
      { field: 'grossLettableAreaSqm', value: '13000', existingValue: '12500' },
      { field: 'unitType', value: 'kiosk', existingValue: 'line_shop' },
    ])
    expect(result!.reasons).toEqual([
      'Property type differs from Market Square in LeaseGuard',
      'Gross lettable area (m²) differs from Market Square in LeaseGuard',
      'Unit type differs from unit Shop 12 of Market Square in LeaseGuard',
    ])
  })

  it('marks a known name and address with another code as a conflict on the code', () => {
    const cells = [...MSQ_CELLS]
    cells[0] = 'MSQ2'
    const [result] = check([row(2, [...cells, '', '', '', ''])])
    expect(result).toMatchObject({ result: 'conflict', conflicts: [{ field: 'propertyCode', value: 'MSQ2', existingValue: 'MSQ' }] })
  })

  it('marks a property given different values on two rows as a conflict with the earlier row', () => {
    const second = [...NEW_CELLS]
    second[1] = 'Kgalagadi Plaza'
    const results = check([row(2, [...NEW_CELLS, 'Shop 1', 'Line shop', '80', '']), row(3, [...second, 'Shop 2', 'Line shop', '90', ''])])
    expect(results[1]).toMatchObject({
      result: 'conflict',
      conflicts: [{ field: 'propertyName', value: 'Kgalagadi Plaza', existingValue: 'Kgalagadi Park', otherRowNumber: 2 }],
      reasons: ['Property name differs from row 2'],
    })
  })

  it('marks a row naming the same property and unit as an earlier row a duplicate', () => {
    const results = check([
      row(2, [...NEW_CELLS, 'Shop 1', 'Line shop', '80', '']),
      row(5, ['KGP', '', '', '', '', '', '', '', '', '', 'Shop 1', 'Kiosk', '10', '']),
      row(6, [...MSQ_CELLS, 'Shop 12', '', '', '']),
      row(7, [...MSQ_CELLS, 'Shop 12', '', '', '']),
    ])
    expect(results.map((r) => r.result)).toEqual(['new', 'duplicate', 'match', 'duplicate'])
    expect(results[1]).toMatchObject({ duplicateOfRowNumber: 2, reasons: ['Row 2 names the same unit'] })
    expect(results[3]!.duplicateOfRowNumber).toBe(6)
  })

  it('applies the property and unit forms’ validation rules and names every problem', () => {
    const [result] = check([row(2, ['M', 'Plaza', 'Castle', '1 Road', '', 'Town', 'City', 'Gautang', '12345', '-5', 'Shop 1', 'Kiosk', '0', 'Maybe'])])
    expect(result!.result).toBe('invalid')
    expect(result!.reasons).toEqual([
      'Property code must be 2 to 8 letters or digits',
      'Property type: "Castle" is not a property type: use Shopping centre, Retail, Office, Industrial / warehouse or Mixed use',
      'Province: "Gautang" is not a South African province',
      'Postal code must be a four-digit South African postal code',
      'Gross lettable area (m²): "-5" is not a number',
      'Floor area (m²) must be more than 0',
      'Unit status: "Maybe" is not a unit status: use Occupied, Vacant, Under offer or Unavailable',
    ])
  })

  it('requires what a new property and a new unit cannot be created without', () => {
    const [result] = check([row(2, ['NEW', 'New Place', '', '', '', '', '', '', '', '', 'A1', '', '', ''])])
    expect(result!.reasons).toEqual([
      'Property type is missing',
      'Address line 1 is missing',
      'Suburb is missing',
      'City is missing',
      'Province is missing',
      'Postal code is missing',
      'Gross lettable area (m²) is missing',
      'Unit type is missing',
      'Floor area (m²) is missing',
    ])
  })

  it('refuses rows with nothing in the mapped columns, and units for an archived property', () => {
    const results = check([row(2, Array.from({ length: 14 }, () => '')), row(3, ['MSQ', '', '', '', '', '', '', '', '', '', 'Shop 99', 'Kiosk', '5', ''])], {
      properties: [{ ...MSQ, status: 'archived' }],
    })
    expect(results[0]).toMatchObject({ result: 'invalid', reasons: ['The row has no values in the mapped columns'] })
    expect(results[1]).toMatchObject({ result: 'invalid', reasons: ['Market Square is archived: restore it before importing units into it'] })
  })

  it('checks units of one property against that property only', () => {
    const columns = ['Shop No', 'Type', 'GLA', 'Status']
    const mapping = { unitNumber: 'Shop No', unitType: 'Type', floorAreaSqm: 'GLA', occupancyStatus: 'Status' }
    const results = check([row(2, ['Shop 12', 'Line shop', '145.5', 'Occupied']), row(3, ['Shop 13', 'Kiosk', '9', 'Vacant']), row(4, ['Shop 12', 'Kiosk', '145.5', ''])], {
      scope: 'units',
      propertyId: 'p-msq',
      columns,
      mapping,
    })
    expect(results.map((r) => r.result)).toEqual(['match', 'new', 'duplicate'])
    expect(results[1]!.reasons).toEqual(['Adds the unit Shop 13 to Market Square'])
  })

  it('reports the cells read for each mapped field, as written', () => {
    const [result] = check([row(2, [...MSQ_CELLS, 'Shop 12', 'Line shop', '145,5', 'Let'])])
    expect(result!.values).toMatchObject({ propertyCode: 'MSQ', floorAreaSqm: '145,5', occupancyStatus: 'Let' })
    expect(result!.values.addressLine2).toBeUndefined()
  })

  describe('with what the manager changed on a row', () => {
    it('reads a corrected value instead of the file cell and checks the row again with it', () => {
      const cells = [...NEW_CELLS, 'Shop 1', 'Line shop', '80', 'Vacant']
      cells[7] = 'Gautng'
      const [before] = check([row(2, cells)])
      expect(before).toMatchObject({ result: 'invalid' })

      const [after] = check([row(2, cells, { corrections: { province: 'Northern Cape' } })])
      expect(after).toMatchObject({ result: 'new', values: { province: 'Northern Cape' } })
      expect(after!.resolution).toEqual({
        corrections: [{ field: 'province', value: 'Northern Cape', fileValue: 'Gautng' }],
        skipped: false,
        tenantSuggestionsRejected: false,
        changedByUserId: 'user-naledi',
        changedAt: '2026-11-21T08:00:00Z',
      })
    })

    it('fills a missing value and clears one with an empty correction', () => {
      const cells = [...NEW_CELLS, 'Shop 1', 'Line shop', '80', 'Vacant']
      cells[3] = ''
      const [filled] = check([row(2, cells, { corrections: { addressLine1: '1 Desert Road' } })])
      expect(filled).toMatchObject({ result: 'new' })
      expect(filled!.resolution!.corrections).toEqual([{ field: 'addressLine1', value: '1 Desert Road' }])

      const [cleared] = check([row(2, [...NEW_CELLS, 'Shop 1', 'Line shop', '80', 'Vacant'], { corrections: { city: '' } })])
      expect(cleared).toMatchObject({ result: 'invalid', reasons: ['City is missing'] })
      expect(cleared!.values.city).toBeUndefined()
    })

    it('ignores corrections to property fields in a units import', () => {
      const unitColumns = ['Unit', 'Type', 'Area']
      const [result] = check([row(2, ['Shop 20', 'Kiosk', '10'], { corrections: { propertyName: 'Elsewhere' } })], {
        scope: 'units',
        propertyId: 'p-msq',
        columns: unitColumns,
        mapping: { unitNumber: 'Unit', unitType: 'Type', floorAreaSqm: 'Area' },
      })
      expect(result).toMatchObject({ result: 'new' })
      expect(result!.values.propertyName).toBeUndefined()
      expect(result!.resolution).toBeUndefined()
    })

    it('skips a row: it is left out and no longer makes a later row its duplicate', () => {
      const cells = [...NEW_CELLS, 'Shop 1', 'Line shop', '80', 'Vacant']
      const plain = check([row(2, cells), row(3, cells)])
      expect(plain.map((r) => r.result)).toEqual(['new', 'duplicate'])

      const resolved = check([row(2, cells, { skipped: true }), row(3, cells)])
      expect(resolved.map((r) => r.result)).toEqual(['skipped', 'new'])
      expect(resolved[0]!.reasons).toEqual(['Skipped: this row is left out of the import'])
      expect(resolved[0]!.resolution).toMatchObject({ skipped: true, changedByUserId: 'user-naledi' })
    })

    it('links a row to an existing property: nothing new is created and its differing values are not used', () => {
      const cells = [...NEW_CELLS, 'Shop 12', 'Kiosk', '145.5', 'Let']
      cells[7] = 'Not a province'
      const [result] = check([row(2, cells, { linkedPropertyId: 'p-msq', linkedUnitId: 'u-12' })])
      expect(result).toMatchObject({
        result: 'match',
        conflicts: [],
        property: { id: 'p-msq' },
        unit: { id: 'u-12' },
        reasons: ['Linked to unit Shop 12 of Market Square in LeaseGuard: nothing new is created for it'],
      })
      expect(result!.resolution).toMatchObject({ linkedProperty: { id: 'p-msq', label: 'Market Square' }, linkedUnit: { id: 'u-12', label: 'Shop 12' } })
    })

    it('adds a new unit to a linked property, holding the unit values to the unit rules', () => {
      const [result] = check([row(2, [...NEW_CELLS, 'Shop 30', 'Kiosk', '12', 'Vacant'], { linkedPropertyId: 'p-msq' })])
      expect(result).toMatchObject({ result: 'new', property: { id: 'p-msq' }, reasons: ['Adds the unit Shop 30 to Market Square'] })
    })

    it('ignores a linked unit that is not of the linked property', () => {
      const other: ExistingUnit = { ...SHOP_12, id: 'u-other', propertyId: 'p-other' }
      const [result] = check([row(2, [...MSQ_CELLS, 'Shop 12', 'Line shop', '145,5', 'Let'], { linkedPropertyId: 'p-msq', linkedUnitId: 'u-other' })], {
        units: [SHOP_12, other],
      })
      expect(result!.resolution!.linkedUnit).toBeUndefined()
      expect(result).toMatchObject({ result: 'match', unit: { id: 'u-12' } })
    })
  })
})

describe('checkPortfolioRows: tenants from the register', () => {
  const TENANT_COLUMNS = [
    'Property code',
    'Unit number',
    'Tenant trading name',
    'Tenant registered name',
    'Tenant registration number',
    'Tenant account reference',
    'Tenant business type',
    'Tenant contact person',
    'Tenant email',
    'Tenant phone',
  ]
  const TENANT_MAPPING = suggestPortfolioImportMapping(TENANT_COLUMNS, 'properties')
  const UBUNTU: ExistingTenant = {
    id: 't-ubuntu',
    tradingName: 'Ubuntu Coffee',
    legalName: 'Ubuntu Coffee Roasters (Pty) Ltd',
    registrationNumber: '2019/987654/07',
    accountReference: 'MSQ-T001',
  }
  const UNITS: ExistingUnit[] = [SHOP_12, { ...SHOP_12, id: 'u-14', unitNumber: 'Shop 14' }, { ...SHOP_12, id: 'u-15', unitNumber: 'Shop 15' }]
  const tenantRow = (rowNumber: number, tenant: string[], unit = 'Shop 12', resolution?: Partial<StoredRowResolution>) =>
    row(rowNumber, ['MSQ', unit, ...tenant], resolution)
  const checkTenants = (rows: ReturnType<typeof row>[], tenants: ExistingTenant[] = [UBUNTU]) =>
    checkPortfolioRows({ scope: 'properties', columns: TENANT_COLUMNS, mapping: TENANT_MAPPING, rows, properties: [MSQ], units: UNITS, tenants })
  const NEW_TENANT = ['Bean There', 'Bean There Coffee (Pty) Ltd', '2015/123456/07', 'MSQ-T012', '', 'Thandi Mokoena', 'accounts@beanthere.co.za', '082 123 4567']

  it('maps the tenant register columns from their headings', () => {
    expect(TENANT_MAPPING).toMatchObject({ tenantTradingName: 'Tenant trading name', tenantPhone: 'Tenant phone' })
  })

  it('proposes a new tenant linked to its unit, with its business type read from the registration number', () => {
    const [result] = checkTenants([tenantRow(2, NEW_TENANT)])
    expect(result).toMatchObject({ result: 'new', unit: { id: 'u-12' } })
    expect(result!.tenant).toMatchObject({ result: 'new', name: 'Bean There', suggestions: [], missingContactDetails: [] })
    expect(result!.reasons).toEqual([
      'Unit Shop 12 of Market Square is already in LeaseGuard with these values',
      'Adds the tenant Bean There to unit Shop 12 of Market Square',
    ])
  })

  it('matches an existing tenant by its exact registration number or account reference only', () => {
    const [byRegistration, byAccount] = checkTenants([
      tenantRow(2, ['Ubuntu', '', '2019 / 987654 / 07', '', '', '', '', '']),
      tenantRow(3, ['Something else entirely', '', '', 'msq-t001', '', '', '', ''], 'Shop 14'),
    ])
    expect(byRegistration).toMatchObject({ result: 'match', tenant: { result: 'match', matchedBy: 'registrationNumber', tenant: { id: 't-ubuntu' } } })
    expect(byAccount!.tenant).toMatchObject({ result: 'match', matchedBy: 'accountReference', tenant: { id: 't-ubuntu', label: 'Ubuntu Coffee' } })
  })

  it('never merges on a similar name: it suggests the tenant and waits for the manager', () => {
    const [similar] = checkTenants([tenantRow(2, ['Ubuntu Coffee', 'Ubuntu Coffee Roasters', '', '', 'Pty Ltd', 'Ayanda', '', '0821234567'])])
    expect(similar).toMatchObject({ result: 'suggested' })
    expect(similar!.tenant).toMatchObject({ result: 'suggested', suggestions: [{ id: 't-ubuntu', tradingName: 'Ubuntu Coffee' }] })
    expect(similar!.tenant!.tenant).toBeUndefined()
  })

  it('links the tenant the manager confirmed, and creates a new one when the suggestion is rejected', () => {
    const cells = ['Ubuntu Coffee', 'Ubuntu Coffee Roasters', '', '', 'Pty Ltd', 'Ayanda', '', '0821234567']
    const [confirmed] = checkTenants([tenantRow(2, cells, 'Shop 12', { linkedTenantId: 't-ubuntu' })])
    expect(confirmed).toMatchObject({ result: 'match', tenant: { result: 'match', matchedBy: 'confirmed', tenant: { id: 't-ubuntu' } } })
    expect(confirmed!.resolution).toMatchObject({ linkedTenant: { id: 't-ubuntu', label: 'Ubuntu Coffee' }, tenantSuggestionsRejected: false })

    const [rejected] = checkTenants([tenantRow(2, cells, 'Shop 12', { tenantSuggestionsRejected: true })])
    expect(rejected).toMatchObject({ result: 'new', tenant: { result: 'new', suggestions: [{ id: 't-ubuntu' }] } })
    expect(rejected!.tenant!.reasons[0]).toMatch(/^Suggested tenants rejected/)
    expect(rejected!.resolution).toMatchObject({ tenantSuggestionsRejected: true })
  })

  it('validates South African phone numbers and emails, and requires what a new tenant cannot be created without', () => {
    const [badContact, missing] = checkTenants([
      tenantRow(2, ['Bean There', 'Bean There (Pty) Ltd', '', '', 'Pty Ltd', 'Thandi', 'not-an-email', '+44 20 7946 0958']),
      tenantRow(3, ['Bean There', '', '', '', '', '', '', ''], 'Shop 14'),
    ])
    expect(badContact).toMatchObject({ result: 'invalid', tenant: { result: 'invalid' } })
    expect(badContact!.reasons).toEqual([
      'Tenant email must be a valid email address',
      'Tenant phone: "+44 20 7946 0958" is not a South African phone number: write it as 082 123 4567 or +27 82 123 4567',
    ])
    expect(missing).toMatchObject({ result: 'invalid', tenant: { result: 'invalid', missingContactDetails: ['contactPerson', 'email', 'phone'] } })
    expect(missing!.reasons).toEqual([
      'Tenant registered name is missing',
      'Tenant contact person is missing: a tenant is created with its contact person',
      'Tenant phone is missing: a tenant is created with its phone number',
      'Tenant business type is missing, and the registration number does not state it',
    ])
  })

  it('lists a missing email without blocking the tenant', () => {
    const cells = [...NEW_TENANT]
    cells[6] = ''
    const [result] = checkTenants([tenantRow(2, cells)])
    expect(result).toMatchObject({ result: 'new', tenant: { result: 'new', missingContactDetails: ['email'] } })
  })

  it('creates a tenant named by its identifier on several rows once, and refuses same-name tenants without one', () => {
    const [first, second, otherName] = checkTenants([
      tenantRow(2, NEW_TENANT),
      tenantRow(3, NEW_TENANT, 'Shop 14'),
      tenantRow(4, ['Bean Here', ...NEW_TENANT.slice(1)], 'Shop 15'),
    ])
    expect(first!.tenant).toMatchObject({ result: 'new' })
    expect(second!.tenant).toMatchObject({ result: 'new', sameAsRowNumber: 2 })
    expect(otherName).toMatchObject({ result: 'conflict', conflicts: [{ field: 'tenantTradingName', value: 'Bean Here', existingValue: 'Bean There', otherRowNumber: 2 }] })

    const noIds = ['Kwik Print', 'Kwik Print CC', '', '', 'CC', 'Sipho', '', '0831112222']
    const [one, two] = checkTenants([tenantRow(2, noIds), tenantRow(3, noIds, 'Shop 14')], [])
    expect(one!.tenant).toMatchObject({ result: 'new' })
    expect(two).toMatchObject({ result: 'conflict', tenant: { result: 'conflict' } })
  })

  it('is a conflict when the identifiers name two tenants, or disagree with the tenant found', () => {
    const other: ExistingTenant = { id: 't-other', tradingName: 'Other', legalName: 'Other (Pty) Ltd', registrationNumber: '2001/111111/07', accountReference: 'MSQ-T099' }
    const [twoTenants, disagree] = checkTenants(
      [
        tenantRow(2, ['Ubuntu Coffee', '', '2019/987654/07', 'MSQ-T099', '', '', '', '']),
        tenantRow(3, ['Ubuntu Coffee', '', '2019/987654/07', 'MSQ-T777', '', '', '', ''], 'Shop 14'),
      ],
      [UBUNTU, other],
    )
    expect(twoTenants).toMatchObject({ result: 'conflict', tenant: { result: 'conflict' } })
    expect(disagree).toMatchObject({ result: 'conflict', conflicts: [{ field: 'tenantAccountReference', value: 'MSQ-T777', existingValue: 'MSQ-T001' }] })
  })

  it('matches a row to the tenant an earlier approval created from it, so approving again never creates it twice', () => {
    const created: ExistingTenant = { id: 't-kwik', tradingName: 'Kwik Print', legalName: 'Kwik Print CC', registrationNumber: null, accountReference: null }
    const cells = ['Kwik Print', 'Kwik Print CC', '', '', 'CC', 'Sipho', '', '0831112222']
    const [result] = checkPortfolioRows({
      scope: 'properties',
      columns: TENANT_COLUMNS,
      mapping: TENANT_MAPPING,
      rows: [tenantRow(2, cells, 'Shop 12', { tenantSuggestionsRejected: true })],
      properties: [MSQ],
      units: UNITS,
      tenants: [UBUNTU, created],
      createdTenants: new Map([[2, 't-kwik']]),
    })
    expect(result).toMatchObject({ result: 'match', tenant: { result: 'match', matchedBy: 'createdByImport', tenant: { id: 't-kwik' } } })
  })

  it('needs the unit a tenant is imported with', () => {
    const [result] = checkPortfolioRows({
      scope: 'properties',
      columns: TENANT_COLUMNS,
      mapping: TENANT_MAPPING,
      rows: [row(2, ['MSQ', '', ...NEW_TENANT])],
      properties: [MSQ],
      units: [],
      tenants: [],
    })
    expect(result).toMatchObject({ result: 'invalid' })
    expect(result!.reasons).toContain('Unit number is missing: a tenant is imported with its unit')
  })

  it('imports tenants with units of one property', () => {
    const columns = ['Unit', 'Tenant', 'Registered name', 'Reg no', 'Contact person', 'Cell']
    const [result] = checkPortfolioRows({
      scope: 'units',
      propertyId: 'p-msq',
      columns,
      mapping: suggestPortfolioImportMapping(columns, 'units'),
      rows: [row(2, ['Shop 12', 'Bean There', 'Bean There (Pty) Ltd', '2015/123456/07', 'Thandi', '082 123 4567'])],
      properties: [MSQ],
      units: [SHOP_12],
      tenants: [],
    })
    expect(result).toMatchObject({ result: 'new', unit: { id: 'u-12' }, tenant: { result: 'new', missingContactDetails: ['email'] } })
  })
})
