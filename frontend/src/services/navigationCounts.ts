import { useMemo } from 'react'

import type { NavBadgeKey } from '@/lib/navigation'

import { usePendingApprovals } from '@/services/communications'
import { useOpenEvents } from '@/services/monitoring'
import { useStatementsForReview } from '@/services/statements'

export type NavBadgeCounts = Readonly<Record<NavBadgeKey, number>>

/** Counts shown as navigation badges, scoped to the active workspace. */
export function useNavBadgeCounts(): NavBadgeCounts {
  const openEvents = useOpenEvents().length
  const pendingApprovals = usePendingApprovals().length
  const pendingReviews = useStatementsForReview().length
  return useMemo(() => ({ openEvents, pendingApprovals, pendingReviews }), [openEvents, pendingApprovals, pendingReviews])
}
