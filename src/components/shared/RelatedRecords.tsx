import { ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

import { AppLink } from './AppLink'
import { LoadingState } from './LoadingState'
import { StatusBadge } from './StatusBadge'

export interface RelatedRecord {
  id: string
  title: string
  subtitle?: string
  href?: string
  /** Enum status rendered with `StatusBadge`. */
  status?: string
  meta?: ReactNode
}

export interface RelatedRecordsProps {
  title: string
  items: RelatedRecord[]
  /** Default `None`. */
  emptyLabel?: string
  viewAllHref?: string
  isLoading?: boolean
  className?: string
}

export function RelatedRecords({ title, items, emptyLabel = 'None', viewAllHref, isLoading = false, className }: RelatedRecordsProps) {
  return (
    <section aria-label={title} className={cn('rounded-xl border border-border bg-card text-card-foreground', className)}>
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold">
          {title}
          {!isLoading ? <span className="ml-1.5 font-normal tabular-nums text-muted-foreground">({items.length})</span> : null}
        </h3>
        {viewAllHref ? (
          <AppLink
            to={viewAllHref}
            className="rounded-sm text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            View all
          </AppLink>
        ) : null}
      </header>
      {isLoading ? (
        <LoadingState rows={3} label={`Loading ${title.toLowerCase()}…`} className="p-4" />
      ) : items.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((item) => {
            const content = (
              <>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{item.title}</p>
                  {item.subtitle ? <p className="truncate text-xs text-muted-foreground">{item.subtitle}</p> : null}
                </div>
                {item.meta ? <div className="shrink-0 text-sm text-muted-foreground">{item.meta}</div> : null}
                {item.status ? <StatusBadge status={item.status} className="shrink-0" /> : null}
              </>
            )
            return (
              <li key={item.id}>
                {item.href ? (
                  <AppLink
                    to={item.href}
                    className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-inset"
                  >
                    {content}
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  </AppLink>
                ) : (
                  <div className="flex items-center gap-3 px-4 py-3">{content}</div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
