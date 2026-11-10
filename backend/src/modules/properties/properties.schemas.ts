import { PROPERTY_STATUSES, PROPERTY_TYPES } from '@leaseguard/domain'
import { z } from 'zod'

import { listQuerySchema } from '../../common/http/pagination'

export const PROPERTY_SORT_FIELDS = ['name', 'code', 'createdAt'] as const

export const propertyListQuerySchema = listQuerySchema(PROPERTY_SORT_FIELDS, {
  status: z.enum(PROPERTY_STATUSES).optional(),
  type: z.enum(PROPERTY_TYPES).optional(),
})
export type PropertyListQuery = z.infer<typeof propertyListQuerySchema>

/** API sort field → database column. */
export const PROPERTY_SORT_COLUMNS = { name: 'name', code: 'code', createdAt: 'created_at' } as const satisfies Record<
  (typeof PROPERTY_SORT_FIELDS)[number],
  string
>
