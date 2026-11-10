import type { EntityId } from '@leaseguard/domain'

import { selectActiveCompanyIdOrNull, useAppStore } from '@/store/appStore'

/**
 * The active workspace's company id, or null when none is selected (until the workspace gate
 * has loaded memberships from `GET /me` and called `setActiveCompany`). Company-scoped queries are
 * disabled while it is null.
 */
export function useActiveCompanyId(): EntityId | null {
  return useAppStore(selectActiveCompanyIdOrNull)
}
