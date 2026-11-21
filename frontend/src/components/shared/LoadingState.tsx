import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

export interface LoadingStateProps {
  /** Screen-reader label. Default `Loading…`. */
  label?: string
  /** Number of skeleton rows. Default 3. */
  rows?: number
  className?: string
}

/** Placeholder entries on hairline rules, the shape of the logbook's own rows, so the page does not jump on load. */
export function LoadingState({ label = 'Loading…', rows = 3, className }: LoadingStateProps) {
  const count = Math.max(1, rows)
  return (
    <div role="status" aria-live="polite" aria-busy="true" className={cn('flex flex-col', className)}>
      <span className="sr-only">{label}</span>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex flex-col gap-2 border-b border-border/60 py-3 first:pt-0 last:border-0 last:pb-0">
          <Skeleton className={cn('h-4', i % 2 === 0 ? 'w-2/5' : 'w-1/3')} />
          <Skeleton className={cn('h-3', i === count - 1 && count > 1 ? 'w-1/4' : 'w-3/5')} />
        </div>
      ))}
    </div>
  )
}
