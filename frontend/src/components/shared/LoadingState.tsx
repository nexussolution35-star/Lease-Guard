import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

export interface LoadingStateProps {
  /** Screen-reader label. Default `Loading…`. */
  label?: string
  /** Number of skeleton rows. Default 3. */
  rows?: number
  className?: string
}

export function LoadingState({ label = 'Loading…', rows = 3, className }: LoadingStateProps) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className={cn('space-y-3', className)}>
      <span className="sr-only">{label}</span>
      {Array.from({ length: Math.max(1, rows) }, (_, i) => (
        <Skeleton key={i} className={cn('h-10 w-full', i === rows - 1 && rows > 1 && 'w-2/3')} />
      ))}
    </div>
  )
}
