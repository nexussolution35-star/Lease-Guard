import type { TenantLeaseRow, TenantListRow, TenantRow } from './tenants.mapper'

export const COMPANY = '6f1d2c1e-0000-4000-8000-000000000001'
export const PROPERTY = '6f1d2c1e-0000-4000-8000-0000000000a1'
export const VALIDATOR = '6f1d2c1e-0000-4000-8000-0000000000f1'

export const tenantRow: TenantRow = {
  id: '6f1d2c1e-0000-4000-8000-0000000000e1',
  company_id: COMPANY,
  legal_name: 'Ubuntu Coffee Roasters (Pty) Ltd',
  trading_name: 'Ubuntu Coffee',
  business_type: 'pty_ltd',
  registration_number: '2019/987654/07',
  account_reference: null,
  vat_number: null,
  contact_full_name: 'Ayanda Nkosi',
  contact_role: 'Owner',
  contact_phone: '+27825550101',
  contact_email: null,
  whatsapp_number: '+27825550101',
  whatsapp_verified: true,
  whatsapp_validated_at: '2026-11-02T09:30:00+00:00',
  whatsapp_validated_by_user_id: VALIDATOR,
  whatsapp_opted_out: false,
  email: 'accounts@ubuntucoffee.co.za',
  status: 'active',
  industry: 'Food and beverage',
  notes: null,
  created_at: '2026-11-01T08:00:00+00:00',
  updated_at: '2026-11-01T08:00:00+00:00',
}

const leaseRow = (overrides: Partial<TenantLeaseRow>): TenantLeaseRow => ({
  id: '6f1d2c1e-0000-4000-8000-0000000000c1',
  reference: 'ACP-001',
  status: 'active',
  verified: true,
  commencement_date: '2025-03-01',
  unit_id: '6f1d2c1e-0000-4000-8000-0000000000b1',
  property_id: PROPERTY,
  unit: { unit_number: '001' },
  property: { name: 'Acacia Park' },
  ...overrides,
})

/** A tenant with an active lease (ACP-001) and a newer draft lease in another property. */
export const tenantListRow: TenantListRow = {
  ...tenantRow,
  leases: [
    leaseRow({
      id: '6f1d2c1e-0000-4000-8000-0000000000c2',
      reference: 'CRV-001',
      status: 'draft',
      verified: false,
      commencement_date: '2026-12-01',
      property_id: '6f1d2c1e-0000-4000-8000-0000000000a2',
      property: { name: 'Crown Village' },
    }),
    leaseRow({}),
  ],
}
