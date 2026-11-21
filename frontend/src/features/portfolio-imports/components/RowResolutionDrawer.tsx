import {
  PORTFOLIO_IMPORT_FIELDS,
  portfolioImportFieldsFor,
  type EntityId,
  type PortfolioImport,
  type PortfolioImportFieldKey,
  type PortfolioImportRowChange,
  type PortfolioImportRowCheck,
} from '@leaseguard/domain'
import { useState } from 'react'
import { toast } from 'sonner'

import { DetailDrawer, SectionHeader, SignOff, StatusDot } from '@/components/shared'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { usePropertyList } from '@/features/properties/api'
import { useUnitList } from '@/features/units/api/queries'
import { describeApiError } from '@/lib/data/apiErrors'
import { MAX_LIST_PAGE_SIZE } from '@/lib/data/listParams'

import { useChangePortfolioImportRow } from '../api/previewQueries'
import { formatImportValue, IMPORT_ROW_RESULT_DISPLAY, IMPORT_TENANT_RESULT_DISPLAY, importFieldLabel, missingContactDetailsLabel } from '../previewLabels'
import { correctionsFromDraft, currentImportValue, fileImportValue } from '../rowChange'

const NO_LINK = '__no_link__'

export interface RowResolutionDrawerProps {
  batch: PortfolioImport
  /** The row as last read in the preview. */
  row: PortfolioImportRowCheck
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The member's name for a sign-off, when they are still in the workspace. */
  memberName: (userId: EntityId | undefined) => string | undefined
}

/**
 * Fixing one row of an import: correct its values, link it to an existing property or unit instead of creating one,
 * confirm or reject the tenants suggested for its tenant, or skip it. Every change is kept on the batch row (never on a
 * property, unit or tenant), checked again at once, and signed off with who made it and when.
 */
export function RowResolutionDrawer({ batch, row, open, onOpenChange, memberName }: RowResolutionDrawerProps) {
  const change = useChangePortfolioImportRow(batch.id)
  // The answer to the last change is the row checked again; it is newer than the page until the page is read again.
  const current = change.data?.rowNumber === row.rowNumber ? change.data : row
  const display = IMPORT_ROW_RESULT_DISPLAY[current.result]

  async function send(body: PortfolioImportRowChange, done: string) {
    try {
      const checked = await change.mutateAsync({ rowNumber: row.rowNumber, change: body })
      toast.success(`${done}. Row ${checked.rowNumber} checked again: ${IMPORT_ROW_RESULT_DISPLAY[checked.result].label}`, {
        description: checked.reasons[0],
      })
    } catch (failure) {
      toast.error('The row was not changed', { description: describeApiError(failure, 'Try again in a moment.') })
    }
  }

  const skipped = current.resolution?.skipped ?? false
  return (
    <DetailDrawer
      open={open}
      onOpenChange={onOpenChange}
      title={`Row ${row.rowNumber}`}
      description="Changes stay with this import. Nothing is added to properties, units or tenants until the import is approved."
      footer={
        <Button
          type="button"
          variant="outline"
          disabled={change.isPending}
          onClick={() => void send({ skipped: !skipped }, skipped ? 'Row included again' : 'Row skipped')}
        >
          {skipped ? 'Include row again' : 'Skip row'}
        </Button>
      }
    >
      <div className="space-y-8">
        <section aria-label="Result" className="space-y-2">
          <StatusDot tone={display.tone}>{display.label}</StatusDot>
          <ul className="space-y-1 text-sm text-muted-foreground">
            {current.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
          {current.resolution ? (
            <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
              Last changed by <SignOff by={memberName(current.resolution.changedByUserId) ?? 'a former member'} at={current.resolution.changedAt} />
            </p>
          ) : null}
        </section>

        {skipped || !current.tenant ? null : (
          <TenantDecision row={current} pending={change.isPending} memberName={memberName} onDecide={(body, done) => void send(body, done)} />
        )}

        {skipped ? null : (
          <ValuesForm
            key={`${current.resolution?.changedAt ?? ''}:${JSON.stringify(current.values)}`}
            batch={batch}
            row={current}
            pending={change.isPending}
            onSave={(body) => void send(body, 'Saved')}
          />
        )}
      </div>
    </DetailDrawer>
  )
}

function ValuesForm({
  batch,
  row,
  pending,
  onSave,
}: {
  batch: PortfolioImport
  row: PortfolioImportRowCheck
  pending: boolean
  onSave: (change: PortfolioImportRowChange) => void
}) {
  const fields = portfolioImportFieldsFor(batch.scope).map((field) => field.key)
  const [draft, setDraft] = useState<Partial<Record<PortfolioImportFieldKey, string>>>(() =>
    Object.fromEntries(fields.map((field) => [field, currentImportValue(row, field)])),
  )
  const linked = { propertyId: row.resolution?.linkedProperty?.id, unitId: row.resolution?.linkedUnit?.id }
  const [link, setLink] = useState<{ propertyId?: EntityId | undefined; unitId?: EntityId | undefined }>(linked)
  const corrections = correctionsFromDraft(row, fields, draft)
  const linkChanged = (link.propertyId ?? '') !== (linked.propertyId ?? '') || (link.unitId ?? '') !== (linked.unitId ?? '')

  function save() {
    const body: PortfolioImportRowChange = {}
    if (corrections) body.corrections = corrections
    if (linkChanged) {
      body.link =
        link.propertyId || link.unitId
          ? { ...(link.propertyId ? { propertyId: link.propertyId } : {}), ...(link.unitId ? { unitId: link.unitId } : {}) }
          : null
    }
    onSave(body)
  }

  return (
    <form
      className="space-y-8"
      onSubmit={(event) => {
        event.preventDefault()
        save()
      }}
    >
      <section aria-label="Link to an existing record" className="space-y-3">
        <SectionHeader
          title="Link to an existing record"
          description="Use a property or unit already in LeaseGuard instead of creating a new one. Its values in LeaseGuard are kept; the file's values for it are not used."
          className="[&_h2]:text-sm"
        />
        {batch.scope === 'properties' ? (
          <PropertyLink value={link.propertyId} onChange={(propertyId) => setLink({ propertyId, unitId: undefined })} />
        ) : null}
        {(batch.scope === 'units' ? batch.propertyId : link.propertyId) ? (
          <UnitLink
            propertyId={(batch.scope === 'units' ? batch.propertyId : link.propertyId) ?? ''}
            value={link.unitId}
            onChange={(unitId) => setLink((current) => ({ ...current, unitId }))}
          />
        ) : null}
      </section>

      <section aria-label="Values" className="space-y-3">
        <SectionHeader title="Values" description="Correct a value here: the row is checked again with it. The file is not changed." className="[&_h2]:text-sm" />
        <div className="space-y-3">
          {fields.map((field) => {
            const id = `import-row-${row.rowNumber}-${field}`
            const fileValue = fileImportValue(row, field)
            const corrected = row.resolution?.corrections.some((entry) => entry.field === field) ?? false
            const ignored = isTenantField(field)
              ? row.resolution?.linkedTenant !== undefined
              : (link.propertyId !== undefined && batch.scope === 'properties' && !isUnitField(field)) || (link.unitId !== undefined && isUnitField(field))
            return (
              <div key={field} className="grid gap-1">
                <Label htmlFor={id} className={ignored ? 'text-muted-foreground' : undefined}>
                  {importFieldLabel(field)}
                </Label>
                <Input
                  id={id}
                  value={draft[field] ?? ''}
                  maxLength={255}
                  disabled={pending}
                  onChange={(event) => setDraft((current) => ({ ...current, [field]: event.target.value }))}
                />
                {corrected ? (
                  <p className="text-xs text-muted-foreground">
                    In the file: {fileValue === '' ? 'empty' : formatImportValue(field, fileValue)}
                  </p>
                ) : null}
                {ignored ? <p className="text-xs text-muted-foreground">Not used: the row is linked to a record in LeaseGuard.</p> : null}
              </div>
            )
          })}
        </div>
      </section>

      <div className="flex justify-end">
        <Button type="submit" disabled={pending || (!corrections && !linkChanged)}>
          {pending ? 'Checking…' : 'Save and check again'}
        </Button>
      </div>
    </form>
  )
}

const fieldsOf = (record: 'unit' | 'tenant'): ReadonlySet<PortfolioImportFieldKey> =>
  new Set(PORTFOLIO_IMPORT_FIELDS.filter((field) => field.record === record).map((field) => field.key))
const UNIT_FIELDS = fieldsOf('unit')
const TENANT_FIELDS = fieldsOf('tenant')
const isUnitField = (field: PortfolioImportFieldKey) => UNIT_FIELDS.has(field)
const isTenantField = (field: PortfolioImportFieldKey) => TENANT_FIELDS.has(field)

/**
 * The row's tenant: how it was matched, and for a tenant with a similar name in LeaseGuard, the manager's decision.
 * Similar names never match on their own: the manager confirms which tenant it is, or rejects the suggestions so a new
 * tenant is created.
 */
function TenantDecision({
  row,
  pending,
  memberName,
  onDecide,
}: {
  row: PortfolioImportRowCheck
  pending: boolean
  memberName: RowResolutionDrawerProps['memberName']
  onDecide: (change: PortfolioImportRowChange, done: string) => void
}) {
  const tenant = row.tenant
  if (!tenant) return null
  const display = IMPORT_TENANT_RESULT_DISPLAY[tenant.result]
  const resolution = row.resolution
  const decided = resolution?.linkedTenant !== undefined || resolution?.tenantSuggestionsRejected === true
  const missing = missingContactDetailsLabel(tenant.result === 'match' ? [] : tenant.missingContactDetails)
  return (
    <section aria-label="Tenant" className="space-y-3">
      <SectionHeader title="Tenant" description="Matched only by the same registration number or account reference, or by your confirmation." className="[&_h2]:text-sm" />
      <div className="space-y-1">
        <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className="font-medium">{tenant.tenant?.label ?? (tenant.name || 'No name')}</span>
          <StatusDot tone={display.tone}>{display.label}</StatusDot>
        </p>
        <ul className="space-y-1 text-sm text-muted-foreground">
          {tenant.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
        {missing ? <p className="text-xs text-muted-foreground">{missing}</p> : null}
      </div>

      {decided && resolution ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-y border-border py-2 text-sm">
          <span className="flex flex-wrap items-center gap-x-2">
            {resolution.linkedTenant ? `Confirmed as ${resolution.linkedTenant.label}` : 'Suggestions rejected'}
            <SignOff by={memberName(resolution.changedByUserId) ?? 'a former member'} at={resolution.changedAt} className="text-xs" />
          </span>
          <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => onDecide({ tenantMatch: null }, 'Decision withdrawn')} className="ml-auto">
            Withdraw
          </Button>
        </div>
      ) : null}

      {tenant.result === 'suggested' ? (
        <>
          <ul aria-label="Suggested tenants" className="divide-y divide-border/70 border-y border-border">
            {tenant.suggestions.map((suggestion) => (
              <li key={suggestion.id} className="flex items-start justify-between gap-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="block font-medium">{suggestion.tradingName}</span>
                  <span className="block text-xs text-muted-foreground">
                    {[suggestion.legalName, suggestion.registrationNumber, suggestion.accountReference].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  aria-label={`Confirm ${suggestion.tradingName}`}
                  onClick={() => onDecide({ tenantMatch: { decision: 'confirmed', tenantId: suggestion.id } }, `Confirmed as ${suggestion.tradingName}`)}
                >
                  This tenant
                </Button>
              </li>
            ))}
          </ul>
          <div className="flex justify-end">
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => onDecide({ tenantMatch: { decision: 'rejected' } }, 'Suggestions rejected')}
            >
              None of these: add a new tenant
            </Button>
          </div>
        </>
      ) : null}
    </section>
  )
}

function PropertyLink({ value, onChange }: { value: EntityId | undefined; onChange: (propertyId: EntityId | undefined) => void }) {
  const properties = usePropertyList({ page: 1, pageSize: MAX_LIST_PAGE_SIZE, sort: 'name', direction: 'asc' })
  return (
    <div className="grid gap-1">
      <Label htmlFor="import-row-link-property">Property</Label>
      <Select value={value ?? NO_LINK} onValueChange={(next) => onChange(next === NO_LINK ? undefined : next)} disabled={properties.isPending}>
        <SelectTrigger id="import-row-link-property" aria-label="Linked property" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_LINK}>Not linked: match by code or name and address</SelectItem>
          {(properties.data?.items ?? []).map((property) => (
            <SelectItem key={property.id} value={property.id}>
              {property.code} · {property.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function UnitLink({ propertyId, value, onChange }: { propertyId: EntityId; value: EntityId | undefined; onChange: (unitId: EntityId | undefined) => void }) {
  const units = useUnitList({ page: 1, pageSize: MAX_LIST_PAGE_SIZE, propertyId, sort: 'unitNumber', direction: 'asc' })
  return (
    <div className="grid gap-1">
      <Label htmlFor="import-row-link-unit">Unit</Label>
      <Select value={value ?? NO_LINK} onValueChange={(next) => onChange(next === NO_LINK ? undefined : next)} disabled={units.isPending}>
        <SelectTrigger id="import-row-link-unit" aria-label="Linked unit" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_LINK}>Not linked: match by unit number</SelectItem>
          {(units.data?.items ?? []).map((unit) => (
            <SelectItem key={unit.id} value={unit.id}>
              {unit.unitNumber}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
