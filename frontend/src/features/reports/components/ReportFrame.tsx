import { Download, Printer } from 'lucide-react'
import type { ReactNode } from 'react'
import { REPORT_FILTER_SUPPORT, type ISODate, type ReportDefinition, type ReportId } from '@leaseguard/domain'

import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState, ErrorState, FilterChips, FilterDropdown, LoadingState, NoActiveWorkspace, type FilterChip } from '@/components/shared'
import { Button } from '@/components/ui/button'
import { usePropertyList } from '@/features/properties/api/queries'
import { useDateFormatter } from '@/lib/dateFormat'
import { MAX_LIST_PAGE_SIZE } from '@/lib/data/listParams'
import { labelFor } from '@/lib/labels'

import { downloadCsv, reportFileName } from '../csv'
import { reportFiltersFromSearch, type ReportSearch } from '../reportSearch'
import { ReportDateRangeFilter } from './ReportDateRangeFilter'

/** The state of the report's query, as the frame needs it. */
export interface ReportFrameQuery {
  isPending: boolean
  isError: boolean
  error: Error | null
  isAwaitingWorkspace: boolean
  /** New figures are loading while the previous ones stay on screen (a filter changed). */
  isRefreshing: boolean
  refetch: () => void
}

export interface ReportFrameProps {
  reportId: ReportId
  definition: ReportDefinition
  search: ReportSearch
  /** Called with the complete next URL state. */
  onSearchChange: (next: ReportSearch) => void
  query: ReportFrameQuery
  /** The date the figures are as at, from the API. */
  asOf?: ISODate
  /** The report has nothing to show for these filters. */
  isEmpty: boolean
  emptyTitle: string
  emptyDescription: string
  /** The CSV of exactly the rows on screen, built when the viewer exports. */
  csv: () => string
  children: ReactNode
}

/**
 * The frame every report shares: the filters it offers (property, date range, status), kept in the URL; the "as at"
 * date; CSV export of exactly the rows shown and a print layout (the app's chrome and the controls are left out of
 * print); and the loading, empty, error and no-workspace states. The figures themselves come from the API.
 */
export function ReportFrame({
  reportId,
  definition,
  search,
  onSearchChange,
  query,
  asOf,
  isEmpty,
  emptyTitle,
  emptyDescription,
  csv,
  children,
}: ReportFrameProps) {
  const support = REPORT_FILTER_SUPPORT[reportId]
  const { date } = useDateFormatter()
  const filters = reportFiltersFromSearch(reportId, search)
  const properties = usePropertyList({ page: 1, pageSize: MAX_LIST_PAGE_SIZE, sort: 'name', direction: 'asc' })
  const propertyName = (id: string) => properties.data?.items.find((property) => property.id === id)?.name ?? 'Selected property'
  const propertyOptions = [
    ...(properties.data?.items ?? []).map((property) => ({ value: property.id, label: property.name })),
    // A selected property that is not in the list (another page, archived) still shows as selected.
    ...(filters.propertyIds ?? [])
      .filter((id) => !properties.data?.items.some((property) => property.id === id))
      .map((id) => ({ value: id, label: 'Selected property' })),
  ]

  const update = (patch: Partial<ReportSearch>) => onSearchChange({ ...search, ...patch })
  const listOrUndefined = (values: readonly string[]) => (values.length > 0 ? [...values] : undefined)

  const chips: FilterChip[] = [
    ...(filters.propertyIds ?? []).map((id) => ({
      id: `property-${id}`,
      label: propertyName(id),
      onRemove: () => update({ propertyId: listOrUndefined((filters.propertyIds ?? []).filter((other) => other !== id)) }),
    })),
    ...(filters.statuses ?? []).map((status) => ({
      id: `status-${status}`,
      label: labelFor(status),
      onRemove: () => update({ status: listOrUndefined((filters.statuses ?? []).filter((other) => other !== status)) }),
    })),
    ...(filters.from || filters.to
      ? [
          {
            id: 'date-range',
            label: `${support.dateRange?.field ?? 'Date'}: ${filters.from ? date(filters.from) : '…'} – ${filters.to ? date(filters.to) : '…'}`,
            onRemove: () => update({ from: undefined, to: undefined }),
          },
        ]
      : []),
  ]
  const clearAll = () => onSearchChange({})

  const ready = !query.isPending && !query.isError
  const exportCsv = () => downloadCsv(reportFileName(reportId, asOf ?? 'undated'), csv())

  const header = (
    <PageHeader
      title={definition.title}
      description={definition.description}
      className="print:hidden"
      actions={
        <>
          <Button type="button" variant="outline" onClick={() => window.print()} disabled={!ready}>
            <Printer aria-hidden="true" />
            Print
          </Button>
          <Button type="button" onClick={exportCsv} disabled={!ready || isEmpty}>
            <Download aria-hidden="true" />
            Export CSV
          </Button>
        </>
      }
    />
  )

  if (query.isAwaitingWorkspace) {
    return (
      <section>
        {header}
        <NoActiveWorkspace />
      </section>
    )
  }

  const filterSummary = chips.map((chip) => chip.label).join(', ')

  return (
    <section aria-busy={query.isRefreshing || undefined}>
      {header}
      <div className="mb-6 flex flex-col gap-3 print:hidden">
        <div role="group" aria-label="Report filters" className="flex flex-wrap items-center gap-2">
          {support.property ? (
            <FilterDropdown<string>
              label="Property"
              options={propertyOptions}
              selected={[...(filters.propertyIds ?? [])]}
              onChange={(ids) => update({ propertyId: listOrUndefined(ids) })}
            />
          ) : null}
          {support.dateRange ? (
            <ReportDateRangeFilter
              field={support.dateRange.field}
              from={filters.from}
              to={filters.to}
              onChange={(range) => update({ from: range.from, to: range.to })}
            />
          ) : null}
          {support.statuses ? (
            <FilterDropdown<string>
              label={support.statuses.label}
              options={support.statuses.values.map((value) => ({ value, label: labelFor(value) }))}
              selected={[...(filters.statuses ?? [])]}
              onChange={(statuses) => update({ status: listOrUndefined(statuses) })}
            />
          ) : null}
        </div>
        <FilterChips chips={chips} onClearAll={clearAll} />
      </div>

      {/* The printed page names the report, its date and its filters, since the controls are not printed. */}
      <div className="mb-4 hidden print:block">
        <p className="text-base font-medium">{definition.title}</p>
        {filterSummary ? <p className="text-xs text-muted-foreground">Filtered: {filterSummary}</p> : null}
      </div>
      {asOf ? (
        <p className="mb-4 text-xs text-muted-foreground tabular-nums">
          As at <time dateTime={asOf}>{date(asOf)}</time>
          {query.isRefreshing ? <span className="print:hidden"> · Updating…</span> : null}
        </p>
      ) : null}

      {query.isPending ? (
        <LoadingState label={`Loading the ${definition.title.toLowerCase()} report…`} rows={4} />
      ) : query.isError ? (
        <ErrorState title="The report could not be loaded" error={query.error ?? 'The report could not be loaded'} onRetry={query.refetch} />
      ) : isEmpty ? (
        <EmptyState
          title={chips.length > 0 ? 'Nothing matches these filters' : emptyTitle}
          description={chips.length > 0 ? 'Change or clear the filters to see more.' : emptyDescription}
          action={
            chips.length > 0 ? (
              <Button type="button" variant="outline" onClick={clearAll}>
                Clear filters
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="flex flex-col gap-10">{children}</div>
      )}
    </section>
  )
}
