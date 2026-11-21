import { AUDIT_ACTIONS, ENTITY_TYPES } from '@leaseguard/domain'
import { ChevronRight, X } from 'lucide-react'
import { useEffect, useId } from 'react'

import { PageHeader } from '@/components/layout/PageHeader'
import {
  DataTable,
  DateDisplay,
  EmptyState,
  ErrorState,
  LoadingState,
  NoActiveWorkspace,
  SignOff,
  SingleSelectFilter,
  type DataTableColumn,
} from '@/components/shared'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { canReadAuditLog } from '@/features/account/permissions'
import { useActiveRole } from '@/features/account/useActiveRole'
import { useMemberList } from '@/features/users/api/queries'
import { describeApiError } from '@/lib/data/apiErrors'
import { lastPageWhenPastEnd, MAX_LIST_PAGE_SIZE } from '@/lib/data/listParams'
import { enumOptions, labelFor } from '@/lib/labels'

import { useAuditLogList } from '../api/queries'
import type { AuditLogEntry } from '../api/source'
import { formatAuditField, formatAuditValue } from '../auditChanges'
import { hasAuditFilters, type AuditFilters, type AuditSearch } from '../auditSearch'

export interface AuditLogScreenProps {
  search: AuditSearch
  /** Applies new filters; the route returns to the first page. */
  onFiltersChange: (filters: AuditFilters) => void
  onPageChange: (page: number) => void
}

const ACTION_OPTIONS = enumOptions(AUDIT_ACTIONS.filter((action) => action !== 'reset_demo_data'))
const ENTITY_OPTIONS = enumOptions(ENTITY_TYPES)
const SYSTEM_ACTOR = 'System'
const FORMER_MEMBER = 'Former member'

function Changes({ entry }: { entry: AuditLogEntry }) {
  const changes = entry.changes ?? []
  if (changes.length === 0) return null
  return (
    <details className="group mt-1.5 text-xs text-muted-foreground">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-sm select-none transition-colors duration-150 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none motion-reduce:transition-none [&::-webkit-details-marker]:hidden">
        <ChevronRight aria-hidden="true" className="size-3.5 transition-transform duration-150 group-open:rotate-90 motion-reduce:transition-none" />
        {changes.length === 1 ? '1 field changed' : `${changes.length} fields changed`}
      </summary>
      <ul className="mt-2 space-y-1 border-l border-border pl-3 tabular-nums">
        {changes.map((change) => (
          <li key={change.field} className="break-words">
            <span className="font-medium text-foreground">{formatAuditField(change.field)}:</span> {formatAuditValue(change.before)}
            <span aria-hidden="true"> → </span>
            <span className="sr-only"> changed to </span>
            <span className="text-foreground">{formatAuditValue(change.after)}</span>
          </li>
        ))}
      </ul>
    </details>
  )
}

/**
 * Settings → Audit log: every recorded change in the active workspace, newest first, filtered by
 * action, record type, person and date. Entries are written by the database and never edited. Property
 * owners are not audit readers (the API refuses them), so they are told instead of shown an error.
 */
export function AuditLogScreen({ search, onFiltersChange, onPageChange }: AuditLogScreenProps) {
  const role = useActiveRole()
  const mayRead = canReadAuditLog(role)
  const fromId = useId()
  const toId = useId()
  const { page, pageSize, action, entityType, actor, from, to } = search
  const filters: AuditFilters = { action, entityType, actor, from, to }

  const query = useAuditLogList(
    { page, pageSize, ...(action ? { action } : {}), ...(entityType ? { entityType } : {}), ...(actor ? { actorUserId: actor } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) },
    { enabled: mayRead },
  )
  // Names for the "who" column and the person filter; someone who has left the workspace is not in it.
  const members = useMemberList({ page: 1, pageSize: MAX_LIST_PAGE_SIZE, sort: 'fullName', direction: 'asc' }, { enabled: mayRead })
  const memberNames = new Map((members.data?.items ?? []).map((member) => [member.id.toLowerCase(), member.fullName]))
  const actorName = (entry: AuditLogEntry) => (entry.actorUserId ? (memberNames.get(entry.actorUserId.toLowerCase()) ?? FORMER_MEMBER) : SYSTEM_ACTOR)
  const memberOptions = (members.data?.items ?? []).map((member) => ({ value: member.id, label: member.fullName }))

  const settled = query.isPlaceholderData ? undefined : query.data
  const lastPage = settled ? lastPageWhenPastEnd(page, settled) : null
  // A page past the end (a stale link, or filters that left fewer entries) moves to the last page.
  useEffect(() => {
    if (lastPage !== null) onPageChange(lastPage)
  }, [lastPage, onPageChange])

  const change = (next: Partial<AuditFilters>) => {
    const merged = { ...filters, ...next }
    // Keep only the filters that are set, so cleared ones leave the address.
    onFiltersChange(Object.fromEntries(Object.entries(merged).filter(([, value]) => value !== undefined && value !== '')) as AuditFilters)
  }

  const header = (
    <PageHeader
      title="Audit log"
      description="Every recorded change in this workspace: who did what, and when. Entries cannot be edited or deleted."
    />
  )

  if (role === null) {
    return (
      <section>
        {header}
        <NoActiveWorkspace />
      </section>
    )
  }

  if (!mayRead) {
    return (
      <section>
        {header}
        <EmptyState
          title="The audit log is not available for your role"
          description="Company admins, property managers and read-only members can see the audit log. Ask a company admin if you need access."
        />
      </section>
    )
  }

  // Each entry reads as a signed line in the logbook: when, what happened, and who signed it.
  const columns: DataTableColumn<AuditLogEntry>[] = [
    {
      id: 'occurredAt',
      header: 'When',
      className: 'w-32 align-top whitespace-normal text-muted-foreground tabular-nums sm:w-44 sm:whitespace-nowrap',
      cell: (entry) => <DateDisplay value={entry.occurredAt} style="datetime" />,
    },
    {
      id: 'entry',
      header: 'Entry',
      className: 'min-w-56 align-top whitespace-normal',
      cell: (entry) => (
        <>
          <span className="block text-foreground">{entry.summary}</span>
          <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <SignOff by={actorName(entry)} className="text-xs" />
            <span aria-hidden="true">·</span>
            <span>{labelFor(entry.action)}</span>
            <span aria-hidden="true">·</span>
            <span>{labelFor(entry.entityType)}</span>
          </span>
          <Changes entry={entry} />
        </>
      ),
    },
  ]

  const isPastEnd = query.data !== undefined && query.data.items.length === 0 && query.data.total > 0
  const filtered = hasAuditFilters(filters)

  return (
    <section>
      {header}
      <div className="flex flex-col gap-4">
        <div role="group" aria-label="Filter the audit log" className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <SingleSelectFilter label="Action" allLabel="All actions" value={action} options={ACTION_OPTIONS} onChange={(value) => change({ action: value })} />
          <SingleSelectFilter label="Record type" allLabel="All records" value={entityType} options={ENTITY_OPTIONS} onChange={(value) => change({ entityType: value })} />
          <SingleSelectFilter label="Person" allLabel="Everyone" value={actor} options={memberOptions} onChange={(value) => change({ actor: value })} />
          <div className="flex items-center gap-2">
            <Label htmlFor={fromId} className="font-normal text-muted-foreground">
              From
            </Label>
            <Input id={fromId} type="date" className="h-9 w-40" value={from ?? ''} max={to} onChange={(event) => change({ from: event.target.value || undefined })} />
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor={toId} className="font-normal text-muted-foreground">
              To
            </Label>
            <Input id={toId} type="date" className="h-9 w-40" value={to ?? ''} min={from} onChange={(event) => change({ to: event.target.value || undefined })} />
          </div>
          {filtered ? (
            <Button type="button" variant="ghost" size="sm" className="h-9" onClick={() => onFiltersChange({})}>
              <X aria-hidden="true" />
              Clear filters
            </Button>
          ) : null}
        </div>
        {query.isPending || isPastEnd ? (
          <LoadingState label="Loading the audit log…" rows={5} />
        ) : query.isError ? (
          <ErrorState title="Could not load the audit log" error={describeApiError(query.error, 'Try again in a moment.')} onRetry={() => void query.refetch()} />
        ) : query.data.total === 0 ? (
          <EmptyState
            title={filtered ? 'No entries match these filters' : 'Nothing has been recorded yet'}
            description={filtered ? 'Try a wider date range or clear the filters.' : 'Changes to this workspace’s records will appear here.'}
          />
        ) : (
          <DataTable
            caption="Audit log entries, newest first"
            columns={columns}
            rows={query.data.items}
            getRowId={(entry) => entry.id}
            pagination={query.data.total > pageSize ? { page, pageSize, total: query.data.total, onPageChange } : undefined}
          />
        )}
      </div>
    </section>
  )
}
