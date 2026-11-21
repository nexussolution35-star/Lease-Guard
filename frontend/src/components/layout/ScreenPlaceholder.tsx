import type { ReactNode } from 'react'

import { PageHeader } from './PageHeader'

export interface ScreenPlaceholderProps {
  title: string
  description?: string
  status?: ReactNode
  className?: string
}

/**
 * A screen that is not available yet. The page name stays in the top bar; the body is one quiet,
 * entry: that the screen is not available yet, and what it will hold (the description).
 */
export function ScreenPlaceholder({ title, description, status, className }: ScreenPlaceholderProps) {
  return (
    <section className={className}>
      <PageHeader title={title} {...(status ? { status } : {})} />
      <div className="max-w-prose pt-2">
        <p className="text-sm font-medium text-foreground">Not available yet.</p>
        {description ? <p className="mt-1 text-sm text-pretty text-muted-foreground">{description}</p> : null}
      </div>
    </section>
  )
}
