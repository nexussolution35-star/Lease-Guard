import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import type { EntityId, User } from '@leaseguard/domain'

import {
  conflictWithDatabaseMessage,
  httpErrorFromDatabase,
  unwrapDatabase,
  type DatabaseErrorOverrides,
} from '../../common/http/database-errors'
import { emptyPageWithTotal, isPageOutOfRange, rangeFor, searchFilter, toPage, type Page } from '../../common/http/pagination'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import { toUser } from './users.mapper'
import { PROFILE_EMBED, USER_SORT_COLUMNS, type UpdateMemberRoleBody, type UserListQuery } from './users.schemas'

const SEARCH_COLUMNS = ['full_name', 'email', 'job_title'] as const

/** Membership columns plus the member's profile (inner join: a member always has a profile). */
const MEMBER_SELECT = 'company_id, role, is_default, joined_at, profile:profiles!inner(*)'

/**
 * The database refuses to leave a company without an active company_admin (P0001, also for the
 * service role); that is a conflict with the company's current state, not invalid input.
 */
const ROLE_CHANGE_OVERRIDES: DatabaseErrorOverrides = { P0001: conflictWithDatabaseMessage }

const REMOVE_OVERRIDES: DatabaseErrorOverrides = {
  P0001: conflictWithDatabaseMessage,
  // Records of the company still name the member (property manager, lease verifier, uploader, ...).
  '23503': () =>
    new ConflictException(
      'This member is still assigned to company records (for example as a property manager or lease verifier); reassign those records first',
    ),
}

const sameId = (a: EntityId, b: EntityId): boolean => a.toLowerCase() === b.toLowerCase()

/**
 * Reads and manages the members of one company. Each `company_users` row of the active company becomes a domain
 * `User` whose `memberships` holds only that company's membership, so a member list never discloses
 * which other companies a colleague belongs to.
 */
@Injectable()
export class UsersService {
  async list(db: DbClient, companyId: EntityId, query: UserListQuery): Promise<Page<User>> {
    const filtered = () => {
      let request = db.from('company_users').select(MEMBER_SELECT, { count: 'exact' }).eq('company_id', companyId)
      if (query.role) request = request.eq('role', query.role)
      if (query.status) request = request.eq(`${PROFILE_EMBED}.status`, query.status)
      if (query.search) request = request.or(searchFilter(SEARCH_COLUMNS, query.search), { referencedTable: PROFILE_EMBED })
      return request
    }

    const sortColumn = USER_SORT_COLUMNS[query.sort ?? 'fullName']
    const { data, error, count } = await filtered()
      .order(sortColumn, { ascending: query.direction === 'asc' })
      .order('user_id', { ascending: true })
      .range(...rangeFor(query))
    if (error) {
      if (isPageOutOfRange(error)) return emptyPageWithTotal(filtered().range(0, 0), query, 'List company users')
      throw httpErrorFromDatabase(error, 'List company users')
    }
    return toPage(data, count, query, ({ profile, ...membership }) => toUser(profile, [membership]))
  }

  /**
   * Changes another member's role (company admins; enforced by the route and by the database). Admins
   * cannot change their own role, and the company always keeps an active company_admin (409).
   */
  async updateRole(
    db: DbClient,
    companyId: EntityId,
    callerUserId: EntityId,
    userId: EntityId,
    body: UpdateMemberRoleBody,
  ): Promise<User> {
    if (sameId(userId, callerUserId)) throw new ForbiddenException('You cannot change your own role; another company admin must do it')
    const { profile, ...membership } = unwrapDatabase(
      await db
        .from('company_users')
        .update({ role: body.role })
        .eq('company_id', companyId)
        .eq('user_id', userId)
        .select(MEMBER_SELECT)
        .maybeSingle(),
      'Update member role',
      ROLE_CHANGE_OVERRIDES,
    )
    return toUser(profile, [membership])
  }

  /**
   * Removes another member from the company (their account and other memberships stay). Refused for
   * the caller themselves, for the last active company_admin, and while company records still name the
   * member (409).
   */
  async remove(db: DbClient, companyId: EntityId, callerUserId: EntityId, userId: EntityId): Promise<void> {
    if (sameId(userId, callerUserId)) {
      throw new ForbiddenException('You cannot remove yourself from a company; another company admin must do it')
    }
    const { data, error } = await db
      .from('company_users')
      .delete()
      .eq('company_id', companyId)
      .eq('user_id', userId)
      .select('user_id')
      .maybeSingle()
    if (error) throw httpErrorFromDatabase(error, 'Remove member', REMOVE_OVERRIDES)
    if (!data) throw new NotFoundException('The member was not found')
  }
}
