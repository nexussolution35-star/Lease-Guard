import { STATEMENT_SOURCES, formatCount, type EntityId, type PortfolioImport, type PortfolioImportSummary, type StatementSource } from '@leaseguard/domain'
import { useState } from 'react'
import { toast } from 'sonner'

import { AppLink, ErrorState, LoadingState, SectionHeader, SignOff, StatusDot } from '@/components/shared'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useIsCompanyWriter } from '@/features/account/useActiveRole'
import { describeApiError } from '@/lib/data/apiErrors'

import { useApprovePortfolioImport, usePortfolioImportSummaryQuery } from '../api/applyQueries'
import { missingContactDetailsLabel } from '../previewLabels'

const ACCOUNTING_OPTIONS = STATEMENT_SOURCES.map((source) => ({ value: source, label: source === 'other' ? 'Other' : source }))

const plural = (count: number, one: string, many: string) => `${formatCount(count)} ${count === 1 ? one : many}`

export interface ImportApprovalProps {
  batch: PortfolioImport
  /** The name of a member, for the sign-off; undefined when they have left the company. */
  memberName: (userId: EntityId | undefined) => string | undefined
}

/**
 * The import summary and its approval: the properties, units and tenants approving creates now, the rows linked to
 * records that exist, skipped or still blocked (suggested tenants among them), the new tenants missing contact details;
 * the approval's sign-off; and every record the import created, each with a link.
 */
export function ImportApproval({ batch, memberName }: ImportApprovalProps) {
  const summary = usePortfolioImportSummaryQuery(batch.id, batch.updatedAt)
  return (
    <section aria-label="Approve the import" className="space-y-3">
      {summary.isPending ? (
        <LoadingState label="Reading the import summary…" />
      ) : summary.isError ? (
        <ErrorState title="The import summary could not be read" error={summary.error} onRetry={() => void summary.refetch()} />
      ) : (
        <Summary batch={batch} summary={summary.data} memberName={memberName} />
      )}
    </section>
  )
}

function Summary({ batch, summary, memberName }: { batch: PortfolioImport; summary: PortfolioImportSummary; memberName: ImportApprovalProps['memberName'] }) {
  const isWriter = useIsCompanyWriter()
  const approve = useApprovePortfolioImport(batch.id)
  const [accountingSystem, setAccountingSystem] = useState<StatementSource | undefined>()
  const [error, setError] = useState<string | undefined>()
  const missingAccountingSystem = summary.needsAccountingSystem && accountingSystem === undefined

  async function submit() {
    if (missingAccountingSystem) {
      setError("Choose the accounting system the new properties' statements come from.")
      return
    }
    setError(undefined)
    try {
      const after = await approve.mutateAsync(summary.needsAccountingSystem && accountingSystem ? { accountingSystem } : {})
      const added = after.created.length - summary.created.length
      toast.success('Import approved', {
        description: added > 0 ? `${plural(added, 'record', 'records')} added to LeaseGuard.` : 'Everything in the file was already in LeaseGuard.',
      })
    } catch (failure) {
      toast.error('The import was not approved', { description: describeApiError(failure, 'Nothing was added. Try again in a moment.') })
    }
  }

  const hasTenants =
    summary.tenantsToCreate + summary.tenantsLinked + summary.tenantSuggestionsToReview + summary.missingContactDetails.length > 0 ||
    summary.created.some((record) => record.recordType === 'tenant')
  const lines: { label: string; value: number; tone?: 'warning' }[] = [
    ...(batch.scope === 'properties' ? [{ label: 'Properties to create', value: summary.propertiesToCreate }] : []),
    { label: 'Units to create', value: summary.unitsToCreate },
    ...(hasTenants
      ? [
          { label: 'Tenants to create', value: summary.tenantsToCreate },
          { label: 'Rows linked to existing tenants', value: summary.tenantsLinked },
          {
            label: 'Suggested tenants to confirm or reject',
            value: summary.tenantSuggestionsToReview,
            ...(summary.tenantSuggestionsToReview > 0 ? { tone: 'warning' as const } : {}),
          },
        ]
      : []),
    { label: 'Rows linked to existing records', value: summary.linkedRows },
    { label: 'Rows skipped', value: summary.skippedRows },
    { label: 'Rows still blocked', value: summary.blockedRows, ...(summary.blockedRows > 0 ? { tone: 'warning' as const } : {}) },
  ]
  const approver = summary.approval ? (memberName(summary.approval.approvedByUserId) ?? 'A former member') : undefined

  return (
    <>
      <SectionHeader
        title="Approve the import"
        description={
          summary.blockedRows > 0
            ? 'Rows still blocked stay out of the import until they are fixed. Fix them and approve again to add them.'
            : `Approving adds the new properties${hasTenants ? ', units and tenants' : ' and units'} to LeaseGuard, all together or not at all.`
        }
        actions={
          isWriter ? (
            <Button type="button" onClick={() => void submit()} disabled={approve.isPending || !summary.canApprove}>
              {approve.isPending ? 'Approving…' : 'Approve and import'}
            </Button>
          ) : null
        }
      />
      <dl aria-label="Import summary" className="divide-y divide-border/70 border-y border-border text-sm">
        {lines.map((line) => (
          <div key={line.label} className="flex items-baseline justify-between gap-4 py-2">
            <dt className="text-muted-foreground">{line.label}</dt>
            <dd className="tabular-nums">{line.tone ? <StatusDot tone={line.tone}>{formatCount(line.value)}</StatusDot> : formatCount(line.value)}</dd>
          </div>
        ))}
      </dl>
      <p className="text-sm text-muted-foreground">
        Tenant messaging stays off: importing never enables or sends messages to tenants
        {hasTenants ? ", and a new tenant's WhatsApp number must be validated before any automated message" : ''}.
      </p>

      {summary.missingContactDetails.length > 0 ? <MissingContactDetails summary={summary} /> : null}

      {isWriter && summary.needsAccountingSystem ? (
        <div className="space-y-1">
          <label htmlFor="import-accounting-system" className="text-sm font-medium">
            Accounting system for the new properties
          </label>
          <Select
            value={accountingSystem ?? ''}
            onValueChange={(value) => {
              setAccountingSystem(value as StatementSource)
              setError(undefined)
            }}
          >
            <SelectTrigger id="import-accounting-system" aria-invalid={error ? true : undefined} className="w-full max-w-64">
              <SelectValue placeholder="Choose the accounting system" />
            </SelectTrigger>
            <SelectContent>
              {ACCOUNTING_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className={error ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
            {error ?? "The system that produces the new properties' statements. You become their property manager; change either on the property later."}
          </p>
        </div>
      ) : null}

      {!summary.canApprove && !summary.approval ? (
        <p className="text-sm text-muted-foreground">Nothing to add yet: every row is linked to an existing record, skipped or still blocked.</p>
      ) : null}

      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Approval</span>
        <SignOff by={approver} at={summary.approval?.approvedAt} pendingLabel="Not approved yet" />
      </div>

      {summary.created.length > 0 ? <CreatedRecords summary={summary} /> : null}
    </>
  )
}

function MissingContactDetails({ summary }: { summary: PortfolioImportSummary }) {
  return (
    <section aria-label="Missing contact details" className="space-y-2 pt-2">
      <SectionHeader
        title="Missing contact details"
        description="New tenants without these details. A tenant cannot be created without its contact person and phone: fill them in on the row."
        className="[&_h2]:text-sm"
      />
      <ul aria-label="Missing contact details" className="divide-y divide-border/70 border-y border-border text-sm">
        {summary.missingContactDetails.map((entry) => (
          <li key={entry.rowNumber} className="flex items-baseline justify-between gap-4 py-2">
            <span className="min-w-0">
              <span className="font-medium">{entry.tenantName || 'A tenant'}</span>
              <span className="text-muted-foreground"> · {missingContactDetailsLabel(entry.missing)}</span>
              {entry.blocksCreation ? (
                <span className="ml-2 inline-block">
                  <StatusDot tone="warning">Blocked</StatusDot>
                </span>
              ) : null}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">Row {entry.rowNumber}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

const RECORD_LABEL: Record<PortfolioImportSummary['created'][number]['recordType'], string> = { property: 'Property', unit: 'Unit', tenant: 'Tenant' }
const RECORD_PATH: Record<PortfolioImportSummary['created'][number]['recordType'], string> = { property: '/properties', unit: '/units', tenant: '/tenants' }

function CreatedRecords({ summary }: { summary: PortfolioImportSummary }) {
  const properties = summary.created.filter((record) => record.recordType === 'property').length
  const tenants = summary.created.filter((record) => record.recordType === 'tenant').length
  const units = summary.created.length - properties - tenants
  return (
    <section aria-label="Records created" className="space-y-2 pt-2">
      <SectionHeader
        title="Records created"
        description={
          tenants > 0
            ? `${plural(properties, 'property', 'properties')}, ${plural(units, 'unit', 'units')} and ${plural(tenants, 'tenant', 'tenants')} added by this import.`
            : `${plural(properties, 'property', 'properties')} and ${plural(units, 'unit', 'units')} added by this import.`
        }
        className="[&_h2]:text-sm"
      />
      <ul aria-label="Records created" className="divide-y divide-border/70 border-y border-border text-sm">
        {summary.created.map((record) => (
          <li key={`${record.recordType}:${record.id}`} className="flex items-baseline justify-between gap-4 py-2">
            <span className="min-w-0">
              <span className="text-muted-foreground">{RECORD_LABEL[record.recordType]} </span>
              <AppLink to={`${RECORD_PATH[record.recordType]}/${encodeURIComponent(record.id)}`} className="font-medium hover:underline">
                {record.label}
              </AppLink>
              {record.recordType === 'unit' ? <span className="text-muted-foreground"> · {record.propertyName}</span> : null}
              {record.recordType === 'tenant' ? (
                <span className="text-muted-foreground">
                  {' '}
                  · {record.unitNumber ? `${record.unitNumber}, ` : ''}
                  {record.propertyName}
                </span>
              ) : null}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">Row {record.rowNumber}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
