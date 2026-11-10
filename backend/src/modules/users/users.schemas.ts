import { USER_ROLES, USER_STATUSES } from '@leaseguard/domain'
import { z } from 'zod'

import { listQuerySchema } from '../../common/http/pagination'

export const USER_SORT_FIELDS = ['fullName', 'email', 'role', 'joinedAt'] as const

export const userListQuerySchema = listQuerySchema(USER_SORT_FIELDS, {
  role: z.enum(USER_ROLES).optional(),
  status: z.enum(USER_STATUSES).optional(),
})
export type UserListQuery = z.infer<typeof userListQuerySchema>

/**
 * The embedded profile's alias in the member query. Profile columns are filtered and sorted through
 * it (PostgREST orders the parent row by a to-one embedded column as `alias(column)`).
 */
export const PROFILE_EMBED = 'profile'

/** API sort field → database column of `company_users`, or of the embedded profile. */
export const USER_SORT_COLUMNS = {
  fullName: `${PROFILE_EMBED}(full_name)`,
  email: `${PROFILE_EMBED}(email)`,
  role: 'role',
  joinedAt: 'joined_at',
} as const satisfies Record<(typeof USER_SORT_FIELDS)[number], string>

/** Body of PATCH /users/:userId/role. */
export const updateMemberRoleBodySchema = z.object({ role: z.enum(USER_ROLES) }).strict()
export type UpdateMemberRoleBody = z.infer<typeof updateMemberRoleBodySchema>
