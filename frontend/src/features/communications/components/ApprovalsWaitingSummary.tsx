import { formatCount } from '@leaseguard/domain'

import { AppLink, DateDisplay, ErrorState, SectionHeader, SignOff } from '@/components/shared'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { describeApiError } from '@/lib/data/apiErrors'
import { isAwaitingWorkspace } from '@/lib/data/queries'
import { cn } from '@/lib/utils'

import { usePendingApprovals } from '../api/queries'

/** The first page of one: the total, and the oldest request (the queue is oldest first). */
const OLDEST_ONLY = { page: 1, pageSize: 1 } as const

export interface ApprovalsWaitingSummaryProps {
  /** Show the "Review messages" button: only where it is the view's one primary action (the dashboard). */
  showAction?: boolean
  className?: string
}

/**
 * How many tenant messages wait on a property manager's sign-off, and since when. Every member sees it; the
 * queue itself is on the approvals screen.
 */
export function ApprovalsWaitingSummary({ showAction = false, className }: ApprovalsWaitingSummaryProps) {
  const query = usePendingApprovals(OLDEST_ONLY)
  if (isAwaitingWorkspace(query)) return null
  const total = query.data?.total
  const oldest = query.data?.items[0]?.approval.requestedAt
  // Where the button leads the view, the heading's link would only repeat it.
  const withButton = showAction && total !== undefined && total > 0

  return (
    <section aria-label="Messages awaiting approval" className={cn('space-y-3', className)}>
      <SectionHeader
        title="Message approvals"
        actions={
          withButton ? undefined : (
            <AppLink to="/communications/approvals" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
              Open message approvals
            </AppLink>
          )
        }
      />
      <div className="flex min-h-14 flex-wrap items-center gap-x-6 gap-y-3 border-y border-border py-3">
        {query.isPending ? (
          <div role="status" aria-live="polite" aria-busy="true" className="flex items-center gap-2">
            <span className="sr-only">Loading messages awaiting approval…</span>
            <Skeleton className="size-5 rounded-full" />
            <Skeleton className="h-4 w-56" />
          </div>
        ) : query.isError ? (
          <ErrorState
            title="Could not load messages awaiting approval"
            error={describeApiError(query.error, 'Try again in a moment.')}
            onRetry={() => void query.refetch()}
            className="border-0 px-0 py-0"
          />
        ) : total === undefined || total === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing awaiting approval</p>
        ) : (
          <>
            <div className="min-w-0 space-y-1">
              <SignOff pendingLabel={total === 1 ? '1 message awaiting approval' : `${formatCount(total)} messages awaiting approval`} />
              {oldest ? (
                <p className="pl-7 text-xs text-muted-foreground">
                  Oldest requested <DateDisplay value={oldest} className="tabular-nums" />
                </p>
              ) : null}
            </div>
            {withButton ? (
              <Button asChild size="sm" className="sm:ml-auto">
                <AppLink to="/communications/approvals">Review messages</AppLink>
              </Button>
            ) : null}
          </>
        )}
      </div>
    </section>
  )
}
