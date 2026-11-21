import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

export interface EmptyStateProps {
  /** Accepted for compatibility; an empty state shows no icon. */
  icon?: LucideIcon
  title: string
  description?: string
  action?: ReactNode
  /** Left-aligned by default; pass `items-center text-center` inside a table frame. The action always ends on the right. */
  className?: string
}

export function EmptyState({ title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-start gap-3 py-8', className)}>
      <div className="max-w-md space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action ? <div className="flex flex-wrap justify-end gap-2 self-stretch">{action}</div> : null}
    </div>
  )
}
