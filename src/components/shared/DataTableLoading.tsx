import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

export interface DataTableLoadingProps {
  columns: number
  /** Default 5. */
  rows?: number
  /** Screen-reader label. Default `Loading records…`. */
  label?: string
  className?: string
}

export function DataTableLoading({ columns, rows = 5, label = 'Loading records…', className }: DataTableLoadingProps) {
  const cols = Math.max(1, columns)
  return (
    <div role="status" aria-live="polite" aria-busy="true" className={cn('w-full overflow-hidden', className)}>
      <span className="sr-only">{label}</span>
      <div className="flex gap-4 border-b border-border px-2 py-3">
        {Array.from({ length: cols }, (_, c) => (
          <Skeleton key={c} className="h-4 flex-1" />
        ))}
      </div>
      {Array.from({ length: Math.max(1, rows) }, (_, r) => (
        <div key={r} className="flex gap-4 border-b border-border px-2 py-3 last:border-0">
          {Array.from({ length: cols }, (_, c) => (
            <Skeleton key={c} className={cn('h-5 flex-1', c === 0 && 'flex-[1.5]')} />
          ))}
        </div>
      ))}
    </div>
  )
}
