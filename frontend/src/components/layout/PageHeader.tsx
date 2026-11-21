import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

import { Breadcrumbs } from './Breadcrumbs'

export interface PageHeaderProps {
  title: string
  description?: string
  actions?: ReactNode
  /** Optional in-page trail; the topbar already shows the route trail. */
  breadcrumbs?: { label: string; to?: string }[]
  /** Status badges shown next to the title. */
  status?: ReactNode
  className?: string
}

/**
 * The page's heading row. The page name is shown in the top bar, so the level-1 heading is kept for
 * screen readers only; the row shows status, description and actions, and is left out when it has none.
 */
export function PageHeader({ title, description, actions, breadcrumbs, status, className }: PageHeaderProps) {
  const heading = <h1 className="sr-only">{title}</h1>
  const trail = breadcrumbs && breadcrumbs.length > 0 ? breadcrumbs : null
  if (!trail && !description && !actions && !status) return heading

  return (
    <header className={cn('mb-6 flex flex-col gap-3', className)}>
      {heading}
      {trail ? <Breadcrumbs items={trail} /> : null}
      {/* One row: status and description on the left, the view's actions on the right. */}
      <div className="flex flex-col gap-3 sm:min-h-9 sm:flex-row sm:items-center sm:justify-between">
        {status || description ? (
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            {status}
            {description ? <p className="max-w-2xl text-pretty text-muted-foreground">{description}</p> : null}
          </div>
        ) : null}
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2 sm:ml-auto">{actions}</div> : null}
      </div>
    </header>
  )
}
