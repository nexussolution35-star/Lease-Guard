import { currentLease, type Tenant, type TenantLeaseSummary, type TenantListItem } from '@leaseguard/domain'

import type { Tables } from '../../infrastructure/database/database.types'

export type TenantRow = Tables<'tenants'>

/** Lease columns the tenant list embeds, with the lease's unit and property (hinted: units also reference leases). */
export const TENANT_LEASE_COLUMNS =
  'id, reference, status, verified, commencement_date, unit_id, property_id, unit:units!leases_unit_fk(unit_number), property:properties!leases_property_fk(name)'

type LeaseRow = Tables<'leases'>
export type TenantLeaseRow = Pick<LeaseRow, 'id' | 'reference' | 'status' | 'verified' | 'commencement_date' | 'unit_id' | 'property_id'> & {
  unit: Pick<Tables<'units'>, 'unit_number'> | null
  property: Pick<Tables<'properties'>, 'name'> | null
}

/** A tenant row with its embedded leases (`leases!leases_tenant_fk(TENANT_LEASE_COLUMNS)`). */
export type TenantListRow = TenantRow & { leases: TenantLeaseRow[] | null }

function toLeaseSummary(row: TenantLeaseRow): TenantLeaseSummary {
  return {
    leaseId: row.id,
    reference: row.reference,
    status: row.status,
    verified: row.verified,
    unitId: row.unit_id,
    unitNumber: row.unit?.unit_number ?? '',
    propertyId: row.property_id,
    propertyName: row.property?.name ?? '',
  }
}

/** A tenant list row: the tenant, its current lease (domain `currentLease`) and how many leases were embedded. */
export function toTenantListItem(row: TenantListRow): TenantListItem {
  const { leases, ...tenant } = row
  const all = leases ?? []
  const current = currentLease(all.map((lease) => ({ id: lease.id, status: lease.status, commencementDate: lease.commencement_date, row: lease })))
  return {
    ...toTenant(tenant),
    ...(current ? { currentLease: toLeaseSummary(current.row) } : {}),
    leaseCount: all.length,
  }
}

/** Database row → domain `Tenant`. Nullable columns become absent optional fields. */
export function toTenant(row: TenantRow): Tenant {
  return {
    id: row.id,
    companyId: row.company_id,
    legalName: row.legal_name,
    tradingName: row.trading_name,
    businessType: row.business_type,
    ...(row.registration_number ? { registrationNumber: row.registration_number } : {}),
    ...(row.account_reference ? { accountReference: row.account_reference } : {}),
    ...(row.vat_number ? { vatNumber: row.vat_number } : {}),
    primaryContact: {
      fullName: row.contact_full_name,
      role: row.contact_role,
      phone: row.contact_phone,
      ...(row.contact_email ? { email: row.contact_email } : {}),
    },
    whatsappNumber: row.whatsapp_number,
    whatsappVerified: row.whatsapp_verified,
    ...(row.whatsapp_validated_at ? { whatsappValidatedAt: row.whatsapp_validated_at } : {}),
    ...(row.whatsapp_validated_by_user_id ? { whatsappValidatedByUserId: row.whatsapp_validated_by_user_id } : {}),
    whatsappOptedOut: row.whatsapp_opted_out,
    ...(row.email ? { email: row.email } : {}),
    status: row.status,
    industry: row.industry,
    ...(row.notes ? { notes: row.notes } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
