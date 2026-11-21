import { isApiError } from '@leaseguard/api-client'
import {
  changedLeaseTerms,
  DEPOSIT_HOLDERS,
  editRequiresReverification,
  ESCALATION_FREQUENCIES,
  ESCALATION_TYPES,
  type Lease,
  type LeaseTermGroup,
} from '@leaseguard/domain'
import { AlertCircle, Info } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useForm, useWatch, type Control, type FieldErrors, type FieldValues } from 'react-hook-form'
import { toast } from 'sonner'

import {
  CheckboxField,
  CurrencyField,
  DateField,
  FormSection,
  FormValidationSummary,
  NumberField,
  SelectField,
  TextAreaField,
  TextField,
  zodResolver,
  type FieldOption,
} from '@/components/forms'
import { ConfirmationDialog, FormDialog } from '@/components/shared'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Form } from '@/components/ui/form'
import { usePropertyList } from '@/features/properties/api/queries'
import { useTenantList } from '@/features/tenants/api/queries'
import { useUnitList } from '@/features/units/api/queries'
import { describeApiError } from '@/lib/data/apiErrors'
import { MAX_LIST_PAGE_SIZE } from '@/lib/data/listParams'
import { enumOptions, labelFor } from '@/lib/labels'

import { useCreateLease, useUpdateLease } from '../api/queries'
import type { LeaseChanges } from '../api/source'
import {
  leaseChangesFrom,
  leaseFieldErrors,
  leaseFormDefaults,
  leaseFormSchema,
  leaseWithChanges,
  newLeaseFormDefaults,
  newLeaseFrom,
  type LeaseFormInput,
  type LeaseFormValues,
} from '../leaseFormSchema'

export interface LeaseFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The lease to edit; omit to add one. */
  lease?: Lease
  /** Called with the saved lease after an add or edit. */
  onSaved?: (lease: Lease) => void
}

type LeaseControl = Control<LeaseFormInput, unknown, LeaseFormValues>

const ESCALATION_TYPE_OPTIONS = enumOptions(ESCALATION_TYPES)
const FREQUENCY_OPTIONS = enumOptions(ESCALATION_FREQUENCIES)
const HOLDER_OPTIONS = enumOptions(DEPOSIT_HOLDERS)

/** Each term group in words, for the re-verification warning. */
const TERM_GROUP_TEXT: Readonly<Record<LeaseTermGroup, string>> = {
  parties: 'tenant, property or unit',
  term: 'commencement or expiry',
  rental: 'rental or due day',
  escalation: 'escalation',
  renewal: 'renewal option',
  deposit: 'deposit',
  guarantee: 'bank guarantee',
}

/** Labels for the validation summary, keyed by field path. */
const FIELD_LABELS: Record<string, string> = {
  reference: 'Lease reference',
  tenantId: 'Tenant',
  propertyId: 'Property',
  unitId: 'Unit',
  commencementDate: 'Commencement',
  expiryDate: 'Expiry',
  initialMonthlyRental: 'Rental at commencement',
  currentMonthlyRental: 'Current monthly rental',
  paymentDueDay: 'Rental due day',
  'escalation.type': 'Escalation type',
  'escalation.percentage': 'Escalation percentage',
  'escalation.fixedAmount': 'Fixed increase',
  'escalation.cpiAssumedPercentage': 'Assumed CPI',
  'escalation.cpiMarginPercentage': 'Margin above CPI',
  'escalation.frequency': 'Escalates',
  'escalation.firstEscalationDate': 'First escalation',
  'renewalOption.renewalTermMonths': 'Renewal term',
  'renewalOption.noticePeriodMonths': 'Notice period',
  'renewalOption.notes': 'Renewal notes',
  'deposit.amount': 'Deposit amount',
  'deposit.basisMonths': 'Deposit months of rental',
  'deposit.heldBy': 'Deposit held by',
  'deposit.receivedOn': 'Deposit received',
  'deposit.notes': 'Deposit notes',
  'bankGuarantee.bank': 'Guarantee bank',
  'bankGuarantee.referenceNumber': 'Guarantee reference',
  'bankGuarantee.amount': 'Guaranteed amount',
  'bankGuarantee.basisMonths': 'Guarantee months of rental',
  'bankGuarantee.issuedOn': 'Guarantee issued',
  'bankGuarantee.expiresOn': 'Guarantee expires',
  'bankGuarantee.notes': 'Guarantee notes',
  notes: 'Notes',
}

const listAll = { page: 1, pageSize: MAX_LIST_PAGE_SIZE } as const

/** Tenant, property and unit: the workspace's tenants, its properties that are not archived, and that property's units. */
function PartyFields({ control, lease }: { control: LeaseControl; lease: Lease | undefined }) {
  const propertyId = useWatch({ control, name: 'propertyId' })
  const tenants = useTenantList({ ...listAll, sort: 'tradingName', direction: 'asc' })
  const properties = usePropertyList({ ...listAll, sort: 'name', direction: 'asc' })
  const units = useUnitList({ ...listAll, sort: 'unitNumber', direction: 'asc', ...(propertyId ? { propertyId } : {}) })

  const tenantOptions: FieldOption[] = (tenants.data?.items ?? []).map((tenant) => ({ value: tenant.id, label: tenant.tradingName }))
  const propertyOptions: FieldOption[] = (properties.data?.items ?? [])
    .filter((property) => property.status !== 'archived' || property.id === lease?.propertyId)
    .map((property) => ({ value: property.id, label: property.name }))
  const unitOptions: FieldOption[] = propertyId
    ? (units.data?.items ?? [])
        .filter((unit) => unit.propertyId === propertyId)
        .map((unit) => ({ value: unit.id, label: `${unit.unitNumber} · ${labelFor(unit.occupancyStatus)}` }))
    : []

  return (
    <>
      <SelectField
        control={control}
        name="tenantId"
        label="Tenant"
        options={tenantOptions}
        placeholder={tenants.isPending ? 'Loading tenants…' : 'Choose a tenant'}
        required
        className="sm:col-span-2"
      />
      <SelectField
        control={control}
        name="propertyId"
        label="Property"
        options={propertyOptions}
        placeholder={properties.isPending ? 'Loading properties…' : 'Choose a property'}
        required
      />
      <SelectField
        control={control}
        name="unitId"
        label="Unit"
        options={unitOptions}
        placeholder={!propertyId ? 'Choose the property first' : units.isPending ? 'Loading units…' : 'Choose a unit'}
        disabled={!propertyId}
        required
      />
    </>
  )
}

/** The amount fields the chosen escalation type uses; a lease without an escalation clause shows none. */
function EscalationFields({ control }: { control: LeaseControl }) {
  const type = useWatch({ control, name: 'escalation.type' })
  if (!type || type === 'none') return null
  return (
    <>
      {type === 'percentage' ? (
        <NumberField control={control} name="escalation.percentage" label="Escalation percentage" suffix="%" min={0} step={0.5} required />
      ) : null}
      {type === 'fixed_amount' ? <CurrencyField control={control} name="escalation.fixedAmount" label="Fixed increase" description="Rand per escalation, excl. VAT." required /> : null}
      {type === 'cpi_linked' ? (
        <>
          <NumberField control={control} name="escalation.cpiAssumedPercentage" label="Assumed CPI" suffix="%" min={0} step={0.1} description="Used to project the escalation." required />
          <NumberField control={control} name="escalation.cpiMarginPercentage" label="Margin above CPI" suffix="%" step={0.1} />
        </>
      ) : null}
      <SelectField control={control} name="escalation.frequency" label="Escalates" options={FREQUENCY_OPTIONS} required />
      <DateField yearDropdown control={control} name="escalation.firstEscalationDate" label="First escalation" description="Later escalations follow the frequency." required />
    </>
  )
}

function RenewalFields({ control }: { control: LeaseControl }) {
  const exists = useWatch({ control, name: 'renewalOption.exists' })
  return (
    <>
      <CheckboxField control={control} name="renewalOption.exists" label="The lease grants a renewal option" className="sm:col-span-2" />
      {exists ? (
        <>
          <NumberField control={control} name="renewalOption.renewalTermMonths" label="Renewal term" suffix="months" min={1} step={1} allowDecimal={false} />
          <NumberField
            control={control}
            name="renewalOption.noticePeriodMonths"
            label="Notice period"
            suffix="months"
            min={0}
            step={1}
            allowDecimal={false}
            description="Written notice needed before expiry."
          />
        </>
      ) : null}
      <TextAreaField control={control} name="renewalOption.notes" label="Renewal notes" rows={2} maxLength={2000} className="sm:col-span-2" />
    </>
  )
}

function DepositFields({ control }: { control: LeaseControl }) {
  const held = useWatch({ control, name: 'deposit.held' })
  return (
    <>
      <CheckboxField control={control} name="deposit.held" label="A deposit is held" className="sm:col-span-2" />
      {held ? (
        <>
          <CurrencyField control={control} name="deposit.amount" label="Deposit amount" required />
          <NumberField control={control} name="deposit.basisMonths" label="Months of rental" suffix="months" min={0} step={0.5} description="Used to check the deposit still covers the rental." />
          <SelectField control={control} name="deposit.heldBy" label="Held by" options={HOLDER_OPTIONS} required />
          <DateField yearDropdown control={control} name="deposit.receivedOn" label="Received" />
          <CheckboxField control={control} name="deposit.interestBearing" label="Interest-bearing" className="sm:col-span-2" />
          <TextAreaField control={control} name="deposit.notes" label="Deposit notes" rows={2} maxLength={2000} className="sm:col-span-2" />
        </>
      ) : null}
    </>
  )
}

function GuaranteeFields({ control }: { control: LeaseControl }) {
  const held = useWatch({ control, name: 'bankGuarantee.held' })
  return (
    <>
      <CheckboxField control={control} name="bankGuarantee.held" label="A bank guarantee is held" className="sm:col-span-2" />
      {held ? (
        <>
          <TextField control={control} name="bankGuarantee.bank" label="Bank" maxLength={200} required />
          <TextField control={control} name="bankGuarantee.referenceNumber" label="Guarantee reference" maxLength={100} required />
          <CurrencyField control={control} name="bankGuarantee.amount" label="Guaranteed amount" required />
          <NumberField control={control} name="bankGuarantee.basisMonths" label="Months of rental" suffix="months" min={0} step={0.5} required />
          <DateField yearDropdown control={control} name="bankGuarantee.issuedOn" label="Issued" required />
          <DateField yearDropdown control={control} name="bankGuarantee.expiresOn" label="Expires" required />
          <TextAreaField control={control} name="bankGuarantee.notes" label="Guarantee notes" rows={2} maxLength={2000} className="sm:col-span-2" />
        </>
      ) : null}
    </>
  )
}

/** "rental and escalation" from the changed term groups. */
function listInWords(groups: readonly LeaseTermGroup[]): string {
  const words = groups.map((group) => TERM_GROUP_TEXT[group])
  return words.length <= 1 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`
}

/**
 * Add or edit a lease in sections: parties, term, rental and escalation, renewal, deposit and guarantee. A new lease
 * starts unverified. Saving a change to a term of a verified lease first asks the person to confirm, because the lease
 * then returns to pending verification and stops driving financial monitoring until verified again (the rule is
 * `editRequiresReverification` in `@leaseguard/domain`; the database applies it). The API enforces every rule; its
 * refusals land on the field they concern.
 */
export function LeaseFormDialog({ open, onOpenChange, lease, onSaved }: LeaseFormDialogProps) {
  const isEdit = lease !== undefined
  const create = useCreateLease()
  const update = useUpdateLease()
  /** The edit waiting on the re-verification confirmation, with the term groups it changes. */
  const [pending, setPending] = useState<{ changes: LeaseChanges; values: LeaseFormValues; groups: LeaseTermGroup[] } | null>(null)

  const defaults = useMemo(() => (lease ? leaseFormDefaults(lease) : newLeaseFormDefaults()), [lease])
  const form = useForm<LeaseFormInput, unknown, LeaseFormValues>({ resolver: zodResolver(leaseFormSchema), defaultValues: defaults })
  const { reset, setValue, subscribe } = form

  // Start from the saved lease (or an empty form) every time the dialog opens.
  useEffect(() => {
    if (open) reset(defaults)
  }, [open, defaults, reset])

  // Another property means another unit: the chosen unit belongs to the previous property.
  useEffect(
    () =>
      subscribe({
        name: 'propertyId',
        formState: { values: true },
        callback: ({ type }) => {
          // `type` is set for a person's change only, not for the reset when the dialog opens.
          if (type === 'change') setValue('unitId', '')
        },
      }),
    [subscribe, setValue],
  )

  function showRefusal(error: unknown) {
    const message = describeApiError(error, 'The lease could not be saved. Try again.')
    const fields = isApiError(error) ? leaseFieldErrors(error.status, error.messages) : []
    if (fields.length === 0) {
      form.setError('root', { type: 'server', message })
      return
    }
    fields.forEach(({ field, message: fieldMessage }, index) => form.setError(field, { type: 'server', message: fieldMessage }, { shouldFocus: index === 0 }))
  }

  async function save(changes: LeaseChanges | null, values: LeaseFormValues) {
    let saved: Lease
    if (lease) {
      if (changes === null) return
      saved = await update.mutateAsync({ id: lease.id, changes })
      toast.success(saved.verified || !lease.verified ? `Lease ${saved.reference} saved` : `Lease ${saved.reference} saved; its terms need verifying again`)
    } else {
      saved = await create.mutateAsync(newLeaseFrom(values))
      toast.success(`Lease ${saved.reference} added; verify its terms before they drive monitoring`)
    }
    onOpenChange(false)
    onSaved?.(saved)
  }

  const submit = form.handleSubmit(async (values) => {
    const changes = lease ? leaseChangesFrom(values, lease) : null
    if (lease && changes === null) {
      toast.info('Nothing to save: the lease is unchanged.')
      onOpenChange(false)
      return
    }
    if (lease && changes) {
      const after = leaseWithChanges(lease, changes)
      if (editRequiresReverification(lease, after)) {
        setPending({ changes, values, groups: changedLeaseTerms(lease, after) })
        return
      }
    }
    try {
      await save(changes, values)
    } catch (error) {
      showRefusal(error)
    }
  })

  async function confirmReverification() {
    if (!pending) return
    try {
      await save(pending.changes, pending.values)
    } catch (error) {
      showRefusal(error)
    } finally {
      setPending(null)
    }
  }

  const { root, ...fieldErrors } = form.formState.errors
  const rootError = root?.message
  const control = form.control

  return (
    <>
      <FormDialog
        open={open}
        onOpenChange={onOpenChange}
        size="lg"
        title={isEdit ? `Edit lease ${lease.reference}` : 'Add lease'}
        description={
          isEdit
            ? 'Changes are recorded in the audit log.'
            : 'Capture the terms from the signed lease. The lease starts unverified: its terms drive financial monitoring once an authorised person verifies them.'
        }
        submitLabel={isEdit ? 'Save changes' : 'Add lease'}
        onSubmit={() => submit()}
        isPending={form.formState.isSubmitting || update.isPending}
      >
        <Form {...form}>
          {lease?.verified ? (
            <p role="note" className="flex gap-2 rounded-md border border-border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>
                These terms are verified. Changing a term (parties, dates, rental, escalation, renewal option, deposit or guarantee)
                returns the lease to pending verification. The reference, notes, deposit receipt date and renewal notes do not.
              </span>
            </p>
          ) : null}
          {form.formState.submitCount > 0 ? <FormValidationSummary errors={fieldErrors as FieldErrors<FieldValues>} fieldLabels={FIELD_LABELS} /> : null}
          {rootError ? (
            <Alert variant="destructive">
              <AlertCircle aria-hidden="true" />
              <AlertDescription>{rootError}</AlertDescription>
            </Alert>
          ) : null}
          <div className="space-y-6 pt-2">
            <FormSection title="Parties">
              <TextField
                control={control}
                name="reference"
                label="Lease reference"
                description="Unique in this workspace, e.g. MSQ-L012."
                placeholder="MSQ-L012"
                maxLength={40}
                required
                className="sm:col-span-2"
              />
              <PartyFields control={control} lease={lease} />
            </FormSection>

            <FormSection title="Term">
              <DateField yearDropdown control={control} name="commencementDate" label="Commencement" required />
              <DateField yearDropdown control={control} name="expiryDate" label="Expiry" required />
              <NumberField control={control} name="paymentDueDay" label="Rental due day" description="Day of each month, 1 to 28." min={1} max={28} step={1} allowDecimal={false} required />
            </FormSection>

            <FormSection title="Rental and escalation" description="Monthly amounts in rand, excluding VAT.">
              <CurrencyField control={control} name="initialMonthlyRental" label="Rental at commencement" required />
              <CurrencyField
                control={control}
                name="currentMonthlyRental"
                label="Current monthly rental"
                description="After escalations applied so far. Leave empty to use the rental at commencement."
              />
              <SelectField control={control} name="escalation.type" label="Escalation type" options={ESCALATION_TYPE_OPTIONS} required className="sm:col-span-2" />
              <EscalationFields control={control} />
            </FormSection>

            <FormSection title="Renewal">
              <RenewalFields control={control} />
            </FormSection>

            <FormSection title="Deposit and guarantee">
              <DepositFields control={control} />
              <GuaranteeFields control={control} />
            </FormSection>

            <FormSection title="Notes" columns={1}>
              <TextAreaField control={control} name="notes" label="Lease notes" rows={3} maxLength={4000} />
            </FormSection>
          </div>
        </Form>
      </FormDialog>

      {lease ? (
        <ConfirmationDialog
          open={pending !== null}
          onOpenChange={(next) => {
            if (!next) setPending(null)
          }}
          title={`Change the verified terms of ${lease.reference}?`}
          description={`This changes the ${listInWords(pending?.groups ?? [])}. The lease returns to pending verification and is not used for financial monitoring until an authorised person verifies the terms again.`}
          confirmLabel="Save and re-verify later"
          onConfirm={confirmReverification}
          isPending={update.isPending}
        />
      ) : null}
    </>
  )
}
