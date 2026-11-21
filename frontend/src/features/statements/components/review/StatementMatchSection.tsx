import {
  formatSADate,
  leaseChoiceProblem,
  leaseInForceOn,
  statementDateForMatching,
  type EntityId,
  type Statement,
  type StatementExtraction,
} from '@leaseguard/domain'
import { AlertCircle, Link2 } from 'lucide-react'
import { useForm, useWatch } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'

import { SelectField, zodResolver } from '@/components/forms'
import { AppLink, InformationGrid, InformationItem, SectionHeader } from '@/components/shared'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Form } from '@/components/ui/form'
import { useLeaseList, useLeaseQuery } from '@/features/leases/api/queries'
import { useTenantList, useTenantQuery } from '@/features/tenants/api/queries'
import { useUnitList, useUnitQuery } from '@/features/units/api/queries'
import { describeApiError } from '@/lib/data/apiErrors'
import { MAX_LIST_PAGE_SIZE } from '@/lib/data/listParams'
import { labelFor } from '@/lib/labels'

import { useSetStatementMatch } from '../../api/queries'

/** The lease option that lets the API choose the lease in force on the statement date. */
const IN_FORCE = 'in-force'

const matchSchema = z.object({
  unitId: z.string({ error: 'Choose the unit' }).min(1, 'Choose the unit'),
  tenantId: z.string({ error: 'Choose the tenant' }).min(1, 'Choose the tenant'),
  leaseId: z.string(),
})
type MatchValues = z.infer<typeof matchSchema>

export interface StatementMatchSectionProps {
  statement: Statement
  extraction: StatementExtraction | null
  /** Writers on a statement under review choose; everyone else reads. */
  canReview: boolean
}

/**
 * The statement's tenant, unit and lease. A writer chooses them from the property's units and tenants, starting from
 * the match the extraction proposed (never applied until saved), and either picks the lease or lets the API take the
 * one in force on the statement date (`leaseInForceOn` shows which that is, or why there is none). The API refuses a
 * tenant, unit and lease that do not belong together.
 */
export function StatementMatchSection({ statement, extraction, canReview }: StatementMatchSectionProps) {
  const proposedTenantId = extraction?.matchedTenantId
  const proposedUnitId = extraction?.matchedUnitId
  const hasMatch = statement.tenantId !== undefined && statement.unitId !== undefined
  const hasProposal = !hasMatch && (proposedTenantId !== undefined || proposedUnitId !== undefined)

  return (
    <section aria-label="Tenant, unit and lease" className="space-y-3">
      <SectionHeader
        title="Tenant, unit and lease"
        description={
          canReview
            ? 'Who the statement belongs to. The lease must be the tenant’s lease of the unit in force on the statement date.'
            : 'Who the statement belongs to.'
        }
      />
      {hasProposal && extraction ? <Proposal extraction={extraction} /> : null}
      {canReview ? (
        <MatchForm
          // Starts again from the saved match (or the proposal, once the extraction is loaded) whenever either changes.
          key={[statement.tenantId, statement.unitId, statement.leaseId, proposedTenantId, proposedUnitId].join('|')}
          statement={statement}
          extraction={extraction}
          defaults={{
            unitId: statement.unitId ?? proposedUnitId ?? '',
            tenantId: statement.tenantId ?? proposedTenantId ?? '',
            leaseId: statement.leaseId ?? IN_FORCE,
          }}
        />
      ) : (
        <CurrentMatch statement={statement} />
      )}
    </section>
  )
}

/** What the extraction proposed, in words, with how sure it was. */
function Proposal({ extraction }: { extraction: StatementExtraction }) {
  const tenant = useTenantQuery(extraction.matchedTenantId ?? '', { enabled: extraction.matchedTenantId !== undefined })
  const unit = useUnitQuery(extraction.matchedUnitId ?? '', { enabled: extraction.matchedUnitId !== undefined })
  const parts = [
    extraction.matchedTenantId ? (tenant.data?.tradingName ?? '…') : null,
    extraction.matchedUnitId ? `unit ${unit.data?.unitNumber ?? '…'}` : null,
  ].filter((part): part is string => part !== null)
  return (
    <p className="flex items-start gap-2 text-sm text-muted-foreground">
      <Link2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>
        Proposed from the statement: <span className="text-foreground">{parts.join(', ')}</span>
        <span className="tabular-nums"> ({Math.round(extraction.matchConfidence * 100)}% sure)</span>. Not applied until it is saved.
      </span>
    </p>
  )
}

/** The saved match, read-only, each part opening its record. */
function CurrentMatch({ statement }: { statement: Statement }) {
  const tenant = useTenantQuery(statement.tenantId ?? '', { enabled: statement.tenantId !== undefined })
  const unit = useUnitQuery(statement.unitId ?? '', { enabled: statement.unitId !== undefined })
  const lease = useLeaseQuery(statement.leaseId ?? '', { enabled: statement.leaseId !== undefined })
  const link = (to: string, text: string) => (
    <AppLink to={to} className="text-foreground hover:underline">
      {text}
    </AppLink>
  )
  return (
    <InformationGrid columns={3} className="gap-y-3 border-y border-border py-3">
      <InformationItem
        label="Tenant"
        value={statement.tenantId ? link(`/tenants/${encodeURIComponent(statement.tenantId)}`, tenant.data?.tradingName ?? '…') : 'Not set'}
      />
      <InformationItem
        label="Unit"
        value={statement.unitId ? link(`/units/${encodeURIComponent(statement.unitId)}`, unit.data?.unitNumber ?? '…') : 'Not set'}
      />
      <InformationItem
        label="Lease"
        value={statement.leaseId ? link(`/leases/${encodeURIComponent(statement.leaseId)}`, lease.data?.reference ?? '…') : 'Not set'}
      />
    </InformationGrid>
  )
}

function MatchForm({ statement, extraction, defaults }: { statement: Statement; extraction: StatementExtraction | null; defaults: MatchValues }) {
  const setMatch = useSetStatementMatch(statement.id)
  const form = useForm<MatchValues>({ resolver: zodResolver(matchSchema), defaultValues: defaults })
  const [unitId, tenantId, leaseId] = useWatch({ control: form.control, name: ['unitId', 'tenantId', 'leaseId'] })

  const units = useUnitList({ page: 1, pageSize: MAX_LIST_PAGE_SIZE, propertyId: statement.propertyId, sort: 'unitNumber', direction: 'asc' })
  const tenants = useTenantList({ page: 1, pageSize: MAX_LIST_PAGE_SIZE, propertyId: statement.propertyId, sort: 'tradingName', direction: 'asc' })
  const leases = useLeaseList({ page: 1, pageSize: MAX_LIST_PAGE_SIZE, propertyId: statement.propertyId, sort: 'commencementDate', direction: 'desc' })

  const unitOptions = (units.data?.items ?? []).map((unit) => ({ value: unit.id, label: unit.unitNumber }))
  const tenantOptions = (tenants.data?.items ?? []).map((tenant) => ({ value: tenant.id, label: tenant.tradingName }))
  // The tenant's leases of the chosen unit: the only leases the API accepts.
  const candidates = (leases.data?.items ?? []).filter((lease) => lease.tenantId === tenantId && lease.unitId === unitId)
  const leaseOptions = [
    { value: IN_FORCE, label: 'The lease in force on the statement date' },
    ...candidates.map((lease) => ({
      value: lease.id,
      label: `${lease.reference} · ${formatSADate(lease.commencementDate)} – ${formatSADate(lease.expiryDate)} · ${labelFor(lease.status)}`,
    })),
  ]

  const date = statementDateForMatching(statement, extraction?.fields ?? [])
  const choice = leaseInForceOn(candidates, date)
  const inForceNote =
    unitId === '' || tenantId === '' || leases.isPending
      ? undefined
      : choice.kind === 'found' && date !== undefined
        ? `In force on ${formatSADate(date)}: ${choice.lease.reference}.`
        : (leaseChoiceProblem(choice) ?? undefined)
  const noteForLease = leaseId === IN_FORCE ? inForceNote : undefined

  const submit = form.handleSubmit(async (values) => {
    try {
      await setMatch.mutateAsync({
        tenantId: values.tenantId as EntityId,
        unitId: values.unitId as EntityId,
        ...(values.leaseId === IN_FORCE ? {} : { leaseId: values.leaseId }),
      })
      toast.success('Tenant, unit and lease saved')
    } catch (error) {
      form.setError('root', { type: 'server', message: describeApiError(error, 'The match was not saved. Try again.') })
    }
  })

  const saved = statement.leaseId !== undefined && !form.formState.isDirty

  return (
    <Form {...form}>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
        className="space-y-4 border-y border-border py-4"
      >
        {form.formState.errors.root?.message ? (
          <Alert variant="destructive">
            <AlertCircle aria-hidden="true" />
            <AlertDescription>{form.formState.errors.root.message}</AlertDescription>
          </Alert>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField control={form.control} name="unitId" label="Unit" options={unitOptions} required placeholder={units.isPending ? 'Loading units…' : 'Choose the unit'} />
          <SelectField
            control={form.control}
            name="tenantId"
            label="Tenant"
            options={tenantOptions}
            required
            placeholder={tenants.isPending ? 'Loading tenants…' : 'Choose the tenant'}
          />
        </div>
        <SelectField
          control={form.control}
          name="leaseId"
          label="Lease"
          options={leaseOptions}
          {...(noteForLease ? { description: noteForLease } : {})}
        />
        <div className="flex flex-wrap items-center justify-end gap-3">
          {saved ? <span className="text-xs text-muted-foreground">Saved</span> : null}
          <Button type="submit" variant="outline" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? 'Saving…' : 'Save tenant, unit and lease'}
          </Button>
        </div>
      </form>
    </Form>
  )
}
