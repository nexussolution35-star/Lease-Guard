import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

export interface InformationGridProps {
  /** `InformationItem` children. */
  children: ReactNode
  /** Default 2. */
  columns?: 1 | 2 | 3
  className?: string
}

const COLUMN_CLASSES: Readonly<Record<1 | 2 | 3, string>> = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
}

export function InformationGrid({ children, columns = 2, className }: InformationGridProps) {
  return <dl className={cn('grid gap-x-6 gap-y-4', COLUMN_CLASSES[columns], className)}>{children}</dl>
}
