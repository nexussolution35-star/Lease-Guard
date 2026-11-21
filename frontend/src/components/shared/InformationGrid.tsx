import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

export interface InformationGridProps {
  /** `InformationItem` children. */
  children: ReactNode
  /** Default 2. */
  columns?: 1 | 2 | 3
  /**
   * `stacked` (default) sets each label above its value. `inline` sets the label in a fixed column beside the
   * value, the definition list of a detail rail; use it with `columns={1}`.
   */
  layout?: 'stacked' | 'inline'
  className?: string
}

const COLUMN_CLASSES: Readonly<Record<1 | 2 | 3, string>> = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
}

export function InformationGrid({ children, columns = 2, layout = 'stacked', className }: InformationGridProps) {
  return (
    <dl
      data-layout={layout}
      className={cn(
        'group/information grid gap-x-6',
        layout === 'inline' ? 'gap-y-2.5' : 'gap-y-4',
        COLUMN_CLASSES[columns],
        className,
      )}
    >
      {children}
    </dl>
  )
}
