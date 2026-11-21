import { ChevronRight } from 'lucide-react'

import { PageHeader } from '@/components/layout/PageHeader'
import { AppLink, EmptyState, ErrorState, LoadingState, NoActiveWorkspace } from '@/components/shared'
import { isAwaitingWorkspace } from '@/lib/data/queries'

import { useReportCatalogue } from '../api/queries'
import { isAvailableReportId } from '../api/source'
import { reportIcon } from './reportIcons'

/**
 * The Reports page: every report LeaseGuard offers (the catalogue the reports service serves), each with its title
 * and description, opening at `/reports/$reportId`. Reports are monitoring summaries of verified records, never
 * transactions; trends and comparisons over time are future work (PRD §17.2).
 */
export function ReportCatalogueScreen() {
  const query = useReportCatalogue()
  const header = (
    <PageHeader
      title="Reports"
      description="Portfolio, occupancy, monitoring, arrears and communication reports, computed from your verified records."
    />
  )

  let body
  if (isAwaitingWorkspace(query)) body = <NoActiveWorkspace />
  else if (query.isPending) body = <LoadingState label="Loading the reports…" rows={6} />
  else if (query.isError) body = <ErrorState title="The reports could not be loaded" error={query.error} onRetry={() => void query.refetch()} />
  else if (query.data.length === 0) body = <EmptyState title="No reports" description="No reports are available for this workspace." />
  else
    body = (
      <ul aria-label="Reports" className="divide-y divide-border border-y border-border">
        {query.data.map((report) => {
          const Icon = reportIcon(report.icon)
          const available = isAvailableReportId(report.id)
          return (
            <li key={report.id}>
              <AppLink
                to={`/reports/${encodeURIComponent(report.id)}`}
                className="group flex items-center gap-4 px-1 py-3 transition-colors hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-hidden focus-visible:ring-inset"
              >
                <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-sm font-medium text-foreground">{report.title}</span>
                  <span className="text-sm text-muted-foreground">{report.description}</span>
                </span>
                {available ? null : <span className="shrink-0 text-xs text-muted-foreground">Not available yet</span>}
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </AppLink>
            </li>
          )
        })}
      </ul>
    )

  return (
    <section>
      {header}
      {body}
    </section>
  )
}
