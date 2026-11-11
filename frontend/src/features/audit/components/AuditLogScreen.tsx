import { AUDIT_ACTIONS, ENTITY_TYPES } from '@leaseguard/domain'
import { History, Lock, X } from 'lucide-react'
import { useEffect, useId } from 'react'

import { PageHeader } from '@/components/layout/PageHeader'
import { DataTable, DateDisplay, EmptyState, ErrorState, LoadingState, NoActiveWorkspace, SingleSelectFilter, type DataTableColumn } from '@/components/shared'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
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
    <details className="mt-1 text-xs text-muted-foreground">
      <summary className="cursor-pointer select-none hover:text-foreground">
        {changes.length === 1 ? '1 field changed' : `${changes.length} fields changed`}
      </summary>
      <ul className="mt-2 space-y-1">
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
      className="pb-0"
    />
  )

  if (role === null) {
    return (
      <section className="space-y-6">
        {header}
        <NoActiveWorkspace />
      </section>
    )
  }

  if (!mayRead) {
    return (
      <section className="space-y-6">
        {header}
        <EmptyState
          icon={Lock}
          title="The audit log is not available for your role"
          description="Company admins, property managers and read-only members can see the audit log. Ask a company admin if you need access."
        />
      </section>
    )
  }

  const columns: DataTableColumn<AuditLogEntry>[] = [
    { id: 'occurredAt', header: 'When', className: 'whitespace-nowrap', cell: (entry) => <DateDisplay value={entry.occurredAt} style="datetime" /> },
    { id: 'actor', header: 'Who', cell: (entry) => <span className={entry.actorUserId ? 'text-foreground' : 'text-muted-foreground'}>{actorName(entry)}</span> },
    { id: 'action', header: 'Action', cell: (entry) => <Badge variant="outline">{labelFor(entry.action)}</Badge> },
    { id: 'entityType', header: 'Record', hideBelow: 'md', cell: (entry) => labelFor(entry.entityType) },
    {
      id: 'summary',
      header: 'What happened',
      className: 'min-w-64 whitespace-normal',
      cell: (entry) => (
        <>
          <span className="text-foreground">{entry.summary}</span>
          <Changes entry={entry} />
        </>
      ),
    },
  ]

  const isPastEnd = query.data !== undefined && query.data.items.length === 0 && query.data.total > 0
  const filtered = hasAuditFilters(filters)

  return (
    <section className="space-y-6">
      {header}
      <Card>
        <CardContent className="space-y-4">
          <div role="group" aria-label="Filter the audit log" className="flex flex-wrap items-end gap-3">
            <SingleSelectFilter label="Action" allLabel="All actions" value={action} options={ACTION_OPTIONS} onChange={(value) => change({ action: value })} />
            <SingleSelectFilter label="Record type" allLabel="All records" value={entityType} options={ENTITY_OPTIONS} onChange={(value) => change({ entityType: value })} />
            <SingleSelectFilter label="Person" allLabel="Everyone" value={actor} options={memberOptions} onChange={(value) => change({ actor: value })} />
            <div className="space-y-1">
              <Label htmlFor={fromId} className="text-xs text-muted-foreground">
                From
              </Label>
              <Input id={fromId} type="date" className="h-9 w-40" value={from ?? ''} max={to} onChange={(event) => change({ from: event.target.value || undefined })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor={toId} className="text-xs text-muted-foreground">
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
              icon={History}
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
        </CardContent>
      </Card>
    </section>
  )
}
