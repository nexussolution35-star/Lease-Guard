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

export function PageHeader({ title, description, actions, breadcrumbs, status, className }: PageHeaderProps) {
  return (
    <header className={cn('flex flex-col gap-3 pb-6', className)}>
      {breadcrumbs && breadcrumbs.length > 0 ? <Breadcrumbs items={breadcrumbs} /> : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
            {status}
          </div>
          {description ? <p className="max-w-3xl text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  )
}
