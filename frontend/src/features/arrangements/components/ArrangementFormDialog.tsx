import {
  arrangementActions,
  arrangementTermsProblems,
  arrearsForArrangementLease,
  finalInstallmentDate,
  formatZAR,
  INSTALLMENT_FREQUENCIES,
  isoToday,
  previewInstallmentSchedule,
  type ISODate,
  type PaymentArrangementListItem,
} from '@leaseguard/domain'
import { AlertCircle, Info } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useForm, useWatch, type Control, type FieldErrors, type FieldValues, type UseFormSetValue } from 'react-hook-form'
import { toast } from 'sonner'

import {
  CurrencyField,
  DateField,
  FormSection,
  FormValidationSummary,
  RadioGroupField,
  SelectField,
  TextAreaField,
  zodResolver,
  type FieldOption,
} from '@/components/forms'
import { FormDialog } from '@/components/shared'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Form } from '@/components/ui/form'
import { useLeaseList } from '@/features/leases/api/queries'
import { useStatementArrears } from '@/features/statements/api/arrearsQueries'
import { useTenantList } from '@/features/tenants/api/queries'
import { describeApiError } from '@/lib/data/apiErrors'
import { MAX_LIST_PAGE_SIZE } from '@/lib/data/listParams'
import { enumOptions, labelFor } from '@/lib/labels'

import { useCreateArrangement, useUpdateArrangement } from '../api/queries'
import {
  arrangementChangesFrom,
  arrangementFormDefaults,
  arrangementFormSchema,
  newArrangementFormDefaults,
  newArrangementFrom,
  termsFromForm,
  type ArrangementFormInput,
  type ArrangementFormValues,
} from '../arrangementFormSchema'
import { useDateFormatter } from '@/lib/dateFormat'

export interface ArrangementFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The arrangement to edit; omit to record one. */
  arrangement?: PaymentArrangementListItem
  /** A new arrangement starts with this tenant chosen (the list's tenant filter). */
  initialTenantId?: string
  /** Called with the saved arrangement after recording or editing it. */
  onSaved?: (arrangement: PaymentArrangementListItem) => void
}

type ArrangementControl = Control<ArrangementFormInput, unknown, ArrangementFormValues>

const FREQUENCY_OPTIONS = enumOptions(INSTALLMENT_FREQUENCIES)
const STATUS_OPTIONS: FieldOption<'active' | 'proposed'>[] = [
  { value: 'active', label: 'Agreed and in force', description: 'Normal arrears reminders to the tenant pause from today.' },
  { value: 'proposed', label: 'Proposed', description: 'Not yet agreed. Arrears reminders carry on until it is made active.' },
]

/** Labels for the validation summary, keyed by field path. */
const FIELD_LABELS: Record<string, string> = {
  tenantId: 'Tenant',
  leaseId: 'Lease',
  propertyId: 'Lease',
  outstandingBalance: 'Outstanding balance',
  installmentAmount: 'Instalment amount',
  frequency: 'Frequency',
  agreedOn: 'Agreed on',
  firstInstallmentDate: 'First instalment',
  notes: 'Notes',
}

/** Instalments listed in the preview; a longer schedule says how many more and when it ends. */
const PREVIEW_ROWS = 6
const listAll = { page: 1, pageSize: MAX_LIST_PAGE_SIZE } as const

/** Tenant and lease of a new arrangement; the lease is listed once the tenant is chosen. */
function PartyFields({ control, setValue }: { control: ArrangementControl; setValue: UseFormSetValue<ArrangementFormInput> }) {
  const tenantId = useWatch({ control, name: 'tenantId' })
  const tenants = useTenantList({ ...listAll, sort: 'tradingName', direction: 'asc' })
  const tenantOptions: FieldOption[] = (tenants.data?.items ?? []).map((tenant) => ({ value: tenant.id, label: tenant.tradingName }))
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
      {tenantId ? (
        <LeaseField control={control} setValue={setValue} tenantId={tenantId} />
      ) : (
        <SelectField control={control} name="leaseId" label="Lease" options={[]} placeholder="Choose the tenant first" disabled required className="sm:col-span-2" />
      )}
    </>
  )
}

/**
 * The tenant's leases. Choosing one sets the arrangement's property and, while the balance is still empty, fills it in
 * from that lease's latest verified statement (domain `arrearsForArrangementLease`); nothing is guessed when no
 * verified statement shows a balance.
 */
function LeaseField({
  control,
  setValue,
  tenantId,
}: {
  control: ArrangementControl
  setValue: UseFormSetValue<ArrangementFormInput>
  tenantId: string
}) {
  const { date: formatDate } = useDateFormatter()
  const leaseId = useWatch({ control, name: 'leaseId' })
  const balance = useWatch({ control, name: 'outstandingBalance' })
  const leases = useLeaseList({ ...listAll, sort: 'reference', direction: 'asc', tenantId })
  const arrears = useStatementArrears()

  const tenantLeases = (leases.data?.items ?? []).filter((lease) => lease.tenantId === tenantId)
  const leaseOptions: FieldOption[] = tenantLeases.map((lease) => ({
    value: lease.id,
    label: `${lease.reference} · ${lease.propertyName} · ${lease.unitNumber} · ${labelFor(lease.status)}`,
  }))
  const propertyId = tenantLeases.find((lease) => lease.id === leaseId)?.propertyId ?? ''
  useEffect(() => {
    setValue('propertyId', propertyId)
  }, [propertyId, setValue])

  const owed = leaseId ? arrearsForArrangementLease(arrears.data?.entries ?? [], tenantId, leaseId) : undefined
  useEffect(() => {
    if (owed && balance === undefined) setValue('outstandingBalance', owed.outstanding, { shouldDirty: true, shouldValidate: true })
  }, [owed, balance, setValue])

  return (
    <SelectField
      control={control}
      name="leaseId"
      label="Lease"
      description={
        owed
          ? `The latest verified statement (${formatDate(owed.statementDate)}) shows ${formatZAR(owed.outstanding)} outstanding on this lease.`
          : 'The lease the arrears are under.'
      }
      options={leaseOptions}
      placeholder={leases.isPending ? 'Loading leases…' : leaseOptions.length === 0 ? 'This tenant has no lease' : 'Choose a lease'}
      required
      className="sm:col-span-2"
    />
  )
}

/** The schedule the terms give (the database generates the same one on saving), and every reason they cannot be saved. */
function SchedulePreview({ control, today }: { control: ArrangementControl; today: ISODate }) {
  const { date: formatDate } = useDateFormatter()
  const values = useWatch({ control })
  const terms = termsFromForm(values)
  if (!terms) {
    return <p className="text-xs text-muted-foreground italic sm:col-span-2">Enter the balance, the instalment and the dates to see the schedule.</p>
  }
  const problems = arrangementTermsProblems(terms, today)
  const schedule = problems.length === 0 ? previewInstallmentSchedule(terms) : []
  const last = finalInstallmentDate(schedule)
  return (
    // Polite: the schedule and the problems follow the person's typing; they should not interrupt it.
    <div aria-live="polite" className="space-y-2 sm:col-span-2">
      {problems.length > 0 ? (
        <ul className="space-y-1 text-sm text-destructive">
          {problems.map((problem) => (
            <li key={problem} className="flex gap-2">
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {problem}
            </li>
          ))}
        </ul>
      ) : (
        <>
          <p className="text-sm">
            <span className="tabular-nums">{schedule.length}</span> {schedule.length === 1 ? 'instalment' : 'instalments'}
            {last ? (
              <>
                , the last due <span className="tabular-nums">{formatDate(last)}</span>
              </>
            ) : null}
            .
          </p>
          <table className="w-full text-sm tabular-nums">
            <caption className="sr-only">Instalment schedule preview</caption>
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th scope="col" className="py-1.5 pr-3 font-medium">
                  #
                </th>
                <th scope="col" className="py-1.5 pr-3 font-medium">
                  Due
                </th>
                <th scope="col" className="py-1.5 text-right font-medium">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60 border-y border-border">
              {schedule.slice(0, PREVIEW_ROWS).map((installment) => (
                <tr key={installment.sequence}>
                  <td className="py-1.5 pr-3">{installment.sequence}</td>
                  <td className="py-1.5 pr-3">{formatDate(installment.dueDate)}</td>
                  <td className="py-1.5 text-right">{formatZAR(installment.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {schedule.length > PREVIEW_ROWS ? (
            <p className="text-xs text-muted-foreground italic">And {schedule.length - PREVIEW_ROWS} more on the same terms.</p>
          ) : null}
        </>
      )}
    </div>
  )
}

/**
 * Record or edit a payment arrangement: the tenant and lease, the balance agreed, the instalment amount and frequency,
 * when it was agreed and when the first instalment is due. LeaseGuard records the agreement only; it never takes or
 * verifies a payment. The schedule and every rule across the terms come from `@leaseguard/domain`
 * (`previewInstallmentSchedule`, `arrangementTermsProblems`) as the terms are typed; the database applies the same
 * rules, refuses a second active arrangement for the tenant, and generates the schedule on saving.
 */
export function ArrangementFormDialog({ open, onOpenChange, arrangement, initialTenantId, onSaved }: ArrangementFormDialogProps) {
  const isEdit = arrangement !== undefined
  const create = useCreateArrangement()
  const update = useUpdateArrangement()
  const scheduleFixed = arrangement ? !arrangementActions(arrangement).editSchedule : false
  // The date when the screen opened: what "in the future" means for the agreement date.
  const [today] = useState(() => isoToday(new Date()))
  const defaults = useMemo(
    () => (arrangement ? arrangementFormDefaults(arrangement) : newArrangementFormDefaults(today, initialTenantId)),
    [arrangement, initialTenantId, today],
  )
  const form = useForm<ArrangementFormInput, unknown, ArrangementFormValues>({ resolver: zodResolver(arrangementFormSchema), defaultValues: defaults })
  const { reset, setValue, subscribe } = form

  // Start from the saved arrangement (or an empty form) every time the dialog opens.
  useEffect(() => {
    if (open) reset(defaults)
  }, [open, defaults, reset])

  // Another tenant means another lease: the chosen lease belongs to the previous tenant.
  useEffect(
    () =>
      subscribe({
        name: 'tenantId',
        formState: { values: true },
        callback: ({ type }) => {
          if (type === 'change') setValue('leaseId', '')
        },
      }),
    [subscribe, setValue],
  )

  const submit = form.handleSubmit(async (values) => {
    if (arrangementTermsProblems(values, today).length > 0) {
      // A root error lasts until the next submit; the reasons themselves are listed with the schedule.
      form.setError('root', { type: 'terms', message: 'The terms cannot be saved yet. The schedule below says why.' })
      return
    }
    try {
      let saved: PaymentArrangementListItem
      if (arrangement) {
        const changes = arrangementChangesFrom(values, arrangement)
        if (changes === null) {
          toast.info('Nothing to save: the arrangement is unchanged.')
          onOpenChange(false)
          return
        }
        saved = await update.mutateAsync({ id: arrangement.id, changes })
        toast.success(`Arrangement with ${saved.tenantName} saved`)
      } else {
        saved = await create.mutateAsync(newArrangementFrom(values))
        toast.success(
          saved.status === 'active'
            ? `Arrangement with ${saved.tenantName} recorded; normal arrears reminders are paused`
            : `Proposed arrangement with ${saved.tenantName} recorded`,
        )
      }
      onOpenChange(false)
      onSaved?.(saved)
    } catch (error) {
      form.setError('root', { type: 'server', message: describeApiError(error, 'The arrangement could not be saved. Try again.') })
    }
  })

  const { root, ...fieldErrors } = form.formState.errors
  const control = form.control

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={isEdit ? `Edit arrangement with ${arrangement.tenantName}` : 'Record payment arrangement'}
      description={
        isEdit
          ? 'Changing the terms generates the schedule again. Changes are recorded in the audit log.'
          : 'Record what the tenant agreed to pay off their arrears. LeaseGuard keeps the record and its schedule; it never takes or processes a payment.'
      }
      submitLabel={isEdit ? 'Save changes' : 'Record arrangement'}
      onSubmit={() => submit()}
      isPending={form.formState.isSubmitting}
    >
      <Form {...form}>
        {form.formState.submitCount > 0 ? <FormValidationSummary errors={fieldErrors as FieldErrors<FieldValues>} fieldLabels={FIELD_LABELS} /> : null}
        {root?.message ? (
          <Alert variant="destructive">
            <AlertCircle aria-hidden="true" />
            <AlertDescription>{root.message}</AlertDescription>
          </Alert>
        ) : null}
        {scheduleFixed ? (
          <p role="note" className="flex gap-2 rounded-md border border-border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              Instalment outcomes are recorded, so the schedule is fixed. To change the terms, cancel this arrangement and
              record a new one.
            </span>
          </p>
        ) : null}
        <div className="space-y-6 pt-2">
          {isEdit ? (
            <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[8rem_minmax(0,1fr)]">
              <dt className="text-muted-foreground">Tenant</dt>
              <dd>{arrangement.tenantName}</dd>
              <dt className="text-muted-foreground">Lease</dt>
              <dd className="tabular-nums">
                {arrangement.leaseReference} · {arrangement.propertyName} · {arrangement.unitNumber}
              </dd>
            </dl>
          ) : (
            <FormSection title="Tenant and lease">
              <PartyFields control={control} setValue={setValue} />
            </FormSection>
          )}

          <FormSection title="Terms" description="Amounts in rand. The last instalment is the remainder of the balance.">
            <CurrencyField control={control} name="outstandingBalance" label="Outstanding balance agreed" disabled={scheduleFixed} required />
            <CurrencyField control={control} name="installmentAmount" label="Instalment amount" disabled={scheduleFixed} required />
            <SelectField control={control} name="frequency" label="Frequency" options={FREQUENCY_OPTIONS} disabled={scheduleFixed} required />
            <DateField control={control} name="agreedOn" label="Agreed on" max={today} required />
            <DateField control={control} name="firstInstallmentDate" label="First instalment due" disabled={scheduleFixed} required />
          </FormSection>

          <FormSection title="Schedule" columns={1}>
            <SchedulePreview control={control} today={today} />
          </FormSection>

          {isEdit ? null : (
            <FormSection title="Status" columns={1}>
              <RadioGroupField control={control} name="status" label="The arrangement is" options={STATUS_OPTIONS} required />
            </FormSection>
          )}

          <FormSection title="Notes" columns={1}>
            <TextAreaField control={control} name="notes" label="Notes" rows={3} maxLength={4000} />
          </FormSection>
        </div>
      </Form>
    </FormDialog>
  )
}
