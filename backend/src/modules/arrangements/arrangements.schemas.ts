import { ARRANGEMENT_STATUSES } from '@leaseguard/domain'
import { z } from 'zod'

import { listQuerySchema } from '../../common/http/pagination'

export const ARRANGEMENT_SORT_FIELDS = ['agreedOn', 'firstInstallmentDate', 'createdAt'] as const

export const arrangementListQuerySchema = listQuerySchema(ARRANGEMENT_SORT_FIELDS, {
  status: z.enum(ARRANGEMENT_STATUSES).optional(),
  leaseId: z.uuid().optional(),
  tenantId: z.uuid().optional(),
})
export type ArrangementListQuery = z.infer<typeof arrangementListQuerySchema>

/** API sort field → database column. */
export const ARRANGEMENT_SORT_COLUMNS = {
  agreedOn: 'agreed_on',
  firstInstallmentDate: 'first_installment_date',
  createdAt: 'created_at',
} as const satisfies Record<(typeof ARRANGEMENT_SORT_FIELDS)[number], string>
