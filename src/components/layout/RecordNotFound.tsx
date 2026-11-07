import { SearchX } from 'lucide-react'

import { AppLink, EmptyState } from '@/components/shared'
import { Button } from '@/components/ui/button'

import { PageHeader } from './PageHeader'

export interface RecordNotFoundProps {
  /** Singular label, e.g. "Property". */
  entityLabel: string
  backTo: string
  backLabel: string
  className?: string
}

/** Shown when a detail route's record does not exist in the ACTIVE workspace. */
export function RecordNotFound({ entityLabel, backTo, backLabel, className }: RecordNotFoundProps) {
  return (
    <section className={className}>
      <PageHeader title={`${entityLabel} not found`} />
      <EmptyState
        icon={SearchX}
        title={`${entityLabel} not found in this workspace`}
        description="It may belong to another company workspace, or it may have been removed. Switch workspace or return to the list."
        action={
          <Button asChild variant="outline" size="sm">
            <AppLink to={backTo}>{backLabel}</AppLink>
          </Button>
        }
      />
    </section>
  )
}
