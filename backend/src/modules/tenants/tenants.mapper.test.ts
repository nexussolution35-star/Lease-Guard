import { describe, expect, it } from 'vitest'

import { toTenant, toTenantListItem } from './tenants.mapper'
import { PROPERTY, tenantListRow, tenantRow, VALIDATOR } from './tenants.test-helpers'

describe('tenants mapper', () => {
  it('maps a tenant row to the domain Tenant with a nested primary contact', () => {
    expect(toTenant(tenantRow)).toEqual({
      id: tenantRow.id,
      companyId: tenantRow.company_id,
      legalName: 'Ubuntu Coffee Roasters (Pty) Ltd',
      tradingName: 'Ubuntu Coffee',
      businessType: 'pty_ltd',
      registrationNumber: '2019/987654/07',
      primaryContact: { fullName: 'Ayanda Nkosi', role: 'Owner', phone: '+27825550101' },
      whatsappNumber: '+27825550101',
      whatsappVerified: true,
      whatsappValidatedAt: '2026-11-02T09:30:00+00:00',
      whatsappValidatedByUserId: VALIDATOR,
      whatsappOptedOut: false,
      email: 'accounts@ubuntucoffee.co.za',
      status: 'active',
      industry: 'Food and beverage',
      createdAt: tenantRow.created_at,
      updatedAt: tenantRow.updated_at,
    })
  })

  it('leaves who validated the number out while it is not validated', () => {
    const tenant = toTenant({ ...tenantRow, whatsapp_verified: false, whatsapp_validated_at: null, whatsapp_validated_by_user_id: null })
    expect(tenant.whatsappVerified).toBe(false)
    expect(tenant).not.toHaveProperty('whatsappValidatedAt')
    expect(tenant).not.toHaveProperty('whatsappValidatedByUserId')
  })

  it('keeps optional contact email, VAT number and notes when present', () => {
    const tenant = toTenant({ ...tenantRow, contact_email: 'ayanda@ubuntucoffee.co.za', vat_number: '4123456789', notes: 'Prefers WhatsApp' })
    expect(tenant.primaryContact.email).toBe('ayanda@ubuntucoffee.co.za')
    expect(tenant).toMatchObject({ vatNumber: '4123456789', notes: 'Prefers WhatsApp' })
  })

  it('maps a list row to the tenant with its current lease, unit and property', () => {
    const item = toTenantListItem(tenantListRow)
    expect(item).toMatchObject({ id: tenantRow.id, tradingName: 'Ubuntu Coffee', leaseCount: 2 })
    expect(item.currentLease).toEqual({
      leaseId: '6f1d2c1e-0000-4000-8000-0000000000c1',
      reference: 'ACP-001',
      status: 'active',
      verified: true,
      unitId: '6f1d2c1e-0000-4000-8000-0000000000b1',
      unitNumber: '001',
      propertyId: PROPERTY,
      propertyName: 'Acacia Park',
    })
    expect(item).not.toHaveProperty('leases')
  })

  it('lists the units the tenant currently holds (by lease or assignment), by property then unit number', () => {
    const item = toTenantListItem({
      ...tenantRow,
      leases: [],
      current_units: [
        { id: 'u10', unit_number: '10', property_id: 'p2', property: { name: 'Maponya Square' } },
        { id: 'u9', unit_number: '9', property_id: 'p2', property: { name: 'Maponya Square' } },
        { id: 'u1', unit_number: '1', property_id: PROPERTY, property: { name: 'Acacia Park' } },
      ],
    })
    expect((item.currentUnits ?? []).map((unit) => `${unit.propertyName} ${unit.unitNumber}`)).toEqual(['Acacia Park 1', 'Maponya Square 9', 'Maponya Square 10'])
    expect(item.currentUnits?.[0]).toEqual({ unitId: 'u1', unitNumber: '1', propertyId: PROPERTY, propertyName: 'Acacia Park' })
    expect(item).not.toHaveProperty('current_units')
  })

  it('leaves the current lease out when the tenant has none', () => {
    const item = toTenantListItem({ ...tenantRow, leases: [] })
    expect(item.currentUnits).toEqual([])
    expect(item.leaseCount).toBe(0)
    expect(item).not.toHaveProperty('currentLease')
  })
})
