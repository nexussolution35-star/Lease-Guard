import type { EntityId } from '@leaseguard/domain'

import { unwrapDatabase } from '../../common/http/database-errors'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import type { MemberNames } from './whatsapp-conversations.mapper'

/** Names of colleagues by user id (profiles are readable by members of a shared company). */
export async function memberNames(db: DbClient, userIds: readonly EntityId[]): Promise<MemberNames> {
  if (userIds.length === 0) return new Map()
  const rows = unwrapDatabase(await db.from('profiles').select('id, full_name').in('id', [...userIds]), 'Load member names')
  return new Map(rows.flatMap((row) => (row.full_name ? [[row.id, row.full_name] as const] : [])))
}
