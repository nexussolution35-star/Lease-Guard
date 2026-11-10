import type { Tenant } from '@leaseguard/domain'

import type { Tables } from '../../infrastructure/database/database.types'

export type TenantRow = Tables<'tenants'>

/** Database row → domain `Tenant`. Nullable columns become absent optional fields. */
export function toTenant(row: TenantRow): Tenant {
  return {
    id: row.id,
    companyId: row.company_id,
    legalName: row.legal_name,
    tradingName: row.trading_name,
    businessType: row.business_type,
    ...(row.registration_number ? { registrationNumber: row.registration_number } : {}),
    ...(row.vat_number ? { vatNumber: row.vat_number } : {}),
    primaryContact: {
      fullName: row.contact_full_name,
      role: row.contact_role,
      phone: row.contact_phone,
      ...(row.contact_email ? { email: row.contact_email } : {}),
    },
    whatsappNumber: row.whatsapp_number,
    whatsappVerified: row.whatsapp_verified,
    whatsappOptedOut: row.whatsapp_opted_out,
    ...(row.email ? { email: row.email } : {}),
    status: row.status,
    industry: row.industry,
    ...(row.notes ? { notes: row.notes } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
