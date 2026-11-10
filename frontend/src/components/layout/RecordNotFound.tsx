import { SearchX } from 'lucide-react'

import { AppLink, EmptyState } from '@/components/shared'
import { Button } from '@/components/ui/button'

import { PageHeader } from './PageHeader'

export interface RecordNotFoundProps {
  /** Singular label, e.g. "Property". */
  entityLabel: string
  backTo: string
  backLabel: string
  /** Overrides "<entity> not found in this workspace" (e.g. for records that are not company-scoped). */
  title?: string
  description?: string
  className?: string
}

/** Shown when a detail route's record does not exist in the ACTIVE workspace. */
const DEFAULT_DESCRIPTION =
  'It may belong to another company workspace, or it may have been removed. Switch workspace or return to the list.'

export function RecordNotFound({ entityLabel, backTo, backLabel, title, description, className }: RecordNotFoundProps) {
  return (
    <section className={className}>
      <PageHeader title={`${entityLabel} not found`} />
      <EmptyState
        icon={SearchX}
        title={title ?? `${entityLabel} not found in this workspace`}
        description={description ?? DEFAULT_DESCRIPTION}
        action={
          <Button asChild variant="outline" size="sm">
            <AppLink to={backTo}>{backLabel}</AppLink>
          </Button>
        }
      />
    </section>
  )
}
