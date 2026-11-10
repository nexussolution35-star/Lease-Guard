import type { Property } from '@leaseguard/domain'

import type { Tables } from '../../infrastructure/database/database.types'

export type PropertyRow = Tables<'properties'>

/** Database row → domain `Property`. Nullable columns become absent optional fields. */
export function toProperty(row: PropertyRow): Property {
  return {
    id: row.id,
    companyId: row.company_id,
    name: row.name,
    code: row.code,
    type: row.type,
    address: {
      line1: row.address_line1,
      ...(row.address_line2 ? { line2: row.address_line2 } : {}),
      suburb: row.suburb,
      city: row.city,
      province: row.province,
      postalCode: row.postal_code,
      country: 'South Africa',
    },
    description: row.description,
    status: row.status,
    grossLettableAreaSqm: row.gross_lettable_area_sqm,
    managerUserId: row.manager_user_id,
    ...(row.owner_user_id ? { ownerUserId: row.owner_user_id } : {}),
    accountingSystem: row.accounting_system,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
