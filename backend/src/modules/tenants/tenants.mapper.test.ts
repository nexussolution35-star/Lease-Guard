import { describe, expect, it } from 'vitest'

import { toTenant } from './tenants.mapper'
import { tenantRow } from './tenants.test-helpers'

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
      whatsappOptedOut: false,
      email: 'accounts@ubuntucoffee.co.za',
      status: 'active',
      industry: 'Food and beverage',
      createdAt: tenantRow.created_at,
      updatedAt: tenantRow.updated_at,
    })
  })

  it('keeps optional contact email, VAT number and notes when present', () => {
    const tenant = toTenant({ ...tenantRow, contact_email: 'ayanda@ubuntucoffee.co.za', vat_number: '4123456789', notes: 'Prefers WhatsApp' })
    expect(tenant.primaryContact.email).toBe('ayanda@ubuntucoffee.co.za')
    expect(tenant).toMatchObject({ vatNumber: '4123456789', notes: 'Prefers WhatsApp' })
  })
})
