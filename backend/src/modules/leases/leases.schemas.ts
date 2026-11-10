import { LEASE_STATUSES } from '@leaseguard/domain'
import { z } from 'zod'

import { listQuerySchema } from '../../common/http/pagination'

export const LEASE_SORT_FIELDS = ['reference', 'commencementDate', 'expiryDate', 'currentMonthlyRental', 'createdAt'] as const

/** Query-string boolean: only the literals `true` and `false` are accepted. */
const queryBoolean = z.enum(['true', 'false']).transform((value) => value === 'true')

export const leaseListQuerySchema = listQuerySchema(LEASE_SORT_FIELDS, {
  status: z.enum(LEASE_STATUSES).optional(),
  propertyId: z.uuid().optional(),
  unitId: z.uuid().optional(),
  tenantId: z.uuid().optional(),
  verified: queryBoolean.optional(),
})
export type LeaseListQuery = z.infer<typeof leaseListQuerySchema>

/** API sort field → database column. */
export const LEASE_SORT_COLUMNS = {
  reference: 'reference',
  commencementDate: 'commencement_date',
  expiryDate: 'expiry_date',
  currentMonthlyRental: 'current_monthly_rental',
  createdAt: 'created_at',
} as const satisfies Record<(typeof LEASE_SORT_FIELDS)[number], string>
