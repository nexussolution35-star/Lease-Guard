import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

export interface MetricGridProps {
  children: ReactNode
  /** Columns at the widest breakpoint. Default 4. */
  columns?: 2 | 3 | 4
  className?: string
}

const COLUMN_CLASSES: Readonly<Record<2 | 3 | 4, string>> = {
  2: '',
  3: 'lg:grid-cols-3 lg:has-[>[data-lead]:first-child]:grid-cols-[1.4fr_repeat(2,minmax(0,1fr))]',
  4: 'xl:grid-cols-4 xl:has-[>[data-lead]:first-child]:grid-cols-[1.4fr_repeat(3,minmax(0,1fr))]',
}

/**
 * One stat strip: a single frame whose cells are divided by hairlines. Each cell's 1px outline falls
 * in the 1px gap, and the frame clips the outer ones, so an unfilled last row stays plain card. When the first
 * cell is the `lead` figure it is given a wider column at the widest breakpoint.
 */
export function MetricGrid({ children, columns = 4, className }: MetricGridProps) {
  return (
    <div
      className={cn(
        'grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-card *:outline *:outline-border',
        COLUMN_CLASSES[columns],
        className,
      )}
    >
      {children}
    </div>
  )
}
