import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

export interface MetricGridProps {
  children: ReactNode
  /** Columns at the widest breakpoint. Default 4. */
  columns?: 2 | 3 | 4
  className?: string
}

const COLUMN_CLASSES: Readonly<Record<2 | 3 | 4, string>> = {
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-2 lg:grid-cols-3',
  4: 'sm:grid-cols-2 xl:grid-cols-4',
}

export function MetricGrid({ children, columns = 4, className }: MetricGridProps) {
  return <div className={cn('grid grid-cols-1 gap-4', COLUMN_CLASSES[columns], className)}>{children}</div>
}
