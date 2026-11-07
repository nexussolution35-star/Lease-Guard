import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

export interface SectionHeaderProps {
  title: string
  description?: string
  actions?: ReactNode
  /** Heading level. Default `h2`. */
  as?: 'h2' | 'h3'
  className?: string
}

export function SectionHeader({ title, description, actions, as: Heading = 'h2', className }: SectionHeaderProps) {
  return (
    <header className={cn('flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between', className)}>
      <div className="min-w-0 space-y-1">
        <Heading className={cn('font-semibold tracking-tight text-foreground', Heading === 'h2' ? 'text-lg' : 'text-base')}>
          {title}
        </Heading>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  )
}
