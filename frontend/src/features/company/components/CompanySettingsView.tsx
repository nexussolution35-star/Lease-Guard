import { Info } from 'lucide-react'
import type { ReactNode } from 'react'

import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState, ErrorState, LoadingState, NoActiveWorkspace } from '@/components/shared'
import { useIsCompanyAdmin } from '@/features/account/useActiveRole'
import { describeApiError } from '@/lib/data/apiErrors'
import { isAwaitingWorkspace } from '@/lib/data/queries'

import { useCompanyProfile } from '../api/queries'
import type { CompanyProfile } from '../api/source'

export interface CompanySettingsViewProps {
  title: string
  description: string
  /** Shown to members who are not company admins, above the read-only content. */
  readOnlyNotice: string
  children: (company: CompanyProfile, isAdmin: boolean) => ReactNode
}

/**
 * Frame of a settings screen about the active company: the page header, then the company once it has
 * loaded (or the loading, error, no-workspace and not-found states). Company admins edit; other members
 * read, and are told so. The API enforces the same rule.
 */
export function CompanySettingsView({ title, description, readOnlyNotice, children }: CompanySettingsViewProps) {
  const isAdmin = useIsCompanyAdmin()
  const query = useCompanyProfile()

  let body: ReactNode
  if (isAwaitingWorkspace(query)) body = <NoActiveWorkspace />
  else if (query.isPending) body = <LoadingState label="Loading the company…" rows={6} />
  else if (query.isError) {
    body = (
      <ErrorState title="Could not load the company" error={describeApiError(query.error, 'Try again in a moment.')} onRetry={() => void query.refetch()} />
    )
  } else if (query.data === null) {
    body = <EmptyState title="Company not found" description="This workspace's company could not be found. Switch workspace or contact Nexus Solution." />
  } else {
    body = (
      <>
        {isAdmin ? null : (
          <p className="flex gap-2 rounded-md border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {readOnlyNotice}
          </p>
        )}
        {children(query.data, isAdmin)}
      </>
    )
  }

  return (
    <section className="space-y-6">
      <PageHeader title={title} description={description} className="pb-0" />
      {body}
    </section>
  )
}
