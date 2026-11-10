import { Injectable } from '@nestjs/common'
import type { EntityId } from '@leaseguard/domain'

import { httpErrorFromDatabase, unwrapDatabase } from '../../common/http/database-errors'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import { toCurrentUserProfile, type CurrentUserProfile } from './auth.mapper'
import type { UpdateMeBody } from './auth.schemas'

const MEMBERSHIP_SELECT = 'company_id, role, is_default, joined_at, company:companies!inner(id, name, trading_name, initials, status)'

/**
 * The signed-in caller's own profile and workspaces. Both queries run through the caller's RLS-bound
 * client and filter by the caller's id explicitly. Row Level Security only counts active profiles as
 * members, so a suspended or deactivated user gets their profile with no memberships.
 */
@Injectable()
export class AuthService {
  async me(db: DbClient, userId: EntityId): Promise<CurrentUserProfile> {
    const [profileResult, membershipResult] = await Promise.all([
      db.from('profiles').select('*').eq('id', userId).maybeSingle(),
      db
        .from('company_users')
        .select(MEMBERSHIP_SELECT)
        .eq('user_id', userId)
        .order('is_default', { ascending: false })
        .order('joined_at', { ascending: true })
        .order('company_id', { ascending: true }),
    ])
    const profile = unwrapDatabase(profileResult, 'Get current user profile')
    if (membershipResult.error) throw httpErrorFromDatabase(membershipResult.error, 'List current user memberships')
    return toCurrentUserProfile(profile, membershipResult.data ?? [])
  }

  /**
   * Updates the caller's own profile. RLS grants users UPDATE on these columns of their own row only
   * (full_name, phone, whatsapp_number, job_title); status and email are never changed here.
   */
  async updateMe(db: DbClient, userId: EntityId, body: UpdateMeBody): Promise<CurrentUserProfile> {
    const patch: { full_name?: string; phone?: string | null; whatsapp_number?: string | null; job_title?: string | null } = {}
    if (body.fullName !== undefined) patch.full_name = body.fullName
    if (body.phone !== undefined) patch.phone = body.phone
    if (body.whatsappNumber !== undefined) patch.whatsapp_number = body.whatsappNumber
    if (body.jobTitle !== undefined) patch.job_title = body.jobTitle
    unwrapDatabase(
      await db.from('profiles').update(patch).eq('id', userId).select('id').maybeSingle(),
      'Update current user profile',
    )
    return this.me(db, userId)
  }
}
