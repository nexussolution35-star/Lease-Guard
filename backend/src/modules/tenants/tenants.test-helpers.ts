import type { TenantRow } from './tenants.mapper'

export const COMPANY = '6f1d2c1e-0000-4000-8000-000000000001'

export const tenantRow: TenantRow = {
  id: '6f1d2c1e-0000-4000-8000-0000000000e1',
  company_id: COMPANY,
  legal_name: 'Ubuntu Coffee Roasters (Pty) Ltd',
  trading_name: 'Ubuntu Coffee',
  business_type: 'pty_ltd',
  registration_number: '2019/987654/07',
  vat_number: null,
  contact_full_name: 'Ayanda Nkosi',
  contact_role: 'Owner',
  contact_phone: '+27825550101',
  contact_email: null,
  whatsapp_number: '+27825550101',
  whatsapp_verified: true,
  whatsapp_opted_out: false,
  email: 'accounts@ubuntucoffee.co.za',
  status: 'active',
  industry: 'Food and beverage',
  notes: null,
  created_at: '2026-11-01T08:00:00+00:00',
  updated_at: '2026-11-01T08:00:00+00:00',
}
