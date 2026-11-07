import { Construction } from 'lucide-react'
import type { ReactNode } from 'react'

import { EmptyState } from '@/components/shared'

import { PageHeader } from './PageHeader'

export interface ScreenPlaceholderProps {
  title: string
  description?: string
  status?: ReactNode
  className?: string
}

/** Temporary screen body used until the feature screen is assembled. */
export function ScreenPlaceholder({ title, description, status, className }: ScreenPlaceholderProps) {
  return (
    <section className={className}>
      <PageHeader title={title} {...(description ? { description } : {})} {...(status ? { status } : {})} />
      <EmptyState
        icon={Construction}
        title="Screen coming in the next stage"
        description="This screen is assembled in the next stage. Navigation, workspace scoping and data services are already in place."
      />
    </section>
  )
}
