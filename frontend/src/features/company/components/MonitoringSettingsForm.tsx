import { WEEKDAYS } from '@leaseguard/domain'
import { AlertCircle } from 'lucide-react'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'

import { FormActions, FormSection, NumberField, SelectField, TextField, zodResolver } from '@/components/forms'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Form } from '@/components/ui/form'
import { describeApiError } from '@/lib/data/apiErrors'
import { enumOptions } from '@/lib/labels'

import { useUpdateCompany } from '../api/queries'
import type { CompanyProfile } from '../api/source'
import {
  monitoringSettingsChangesFrom,
  monitoringSettingsFormDefaults,
  monitoringSettingsFormSchema,
  type MonitoringSettingsFormValues,
} from '../monitoringSettingsSchema'

export interface MonitoringSettingsFormProps {
  settings: CompanyProfile['settings']
}

const WEEKDAY_OPTIONS = enumOptions(WEEKDAYS)
const NOTICE_HINT = 'Days before, separated by commas, e.g. 180, 90, 30.'
const FALLBACK_ERROR = 'The settings could not be saved. Try again.'

/** Notice periods and reminder timing a company admin sets for the workspace. */
export function MonitoringSettingsForm({ settings }: MonitoringSettingsFormProps) {
  const update = useUpdateCompany()
  const form = useForm<MonitoringSettingsFormValues>({
    resolver: zodResolver(monitoringSettingsFormSchema),
    defaultValues: monitoringSettingsFormDefaults(settings),
  })
  const { reset } = form

  // Follow the saved settings: after a save, and when the workspace changes.
  useEffect(() => {
    reset(monitoringSettingsFormDefaults(settings))
  }, [settings, reset])

  const rootError = form.formState.errors.root?.message

  const submit = form.handleSubmit(async (values) => {
    const changes = monitoringSettingsChangesFrom(values, settings)
    if (changes === null) {
      toast.info('Nothing to save: the settings are unchanged.')
      return
    }
    try {
      await update.mutateAsync(changes)
      toast.success('Settings saved')
    } catch (error) {
      form.setError('root', { type: 'server', message: describeApiError(error, FALLBACK_ERROR) })
    }
  })

  return (
    <Form {...form}>
      <form onSubmit={(event) => void submit(event)} noValidate className="space-y-8" aria-label="Notice periods and reminder timing">
        {rootError ? (
          <Alert variant="destructive">
            <AlertCircle aria-hidden="true" />
            <AlertDescription>{rootError}</AlertDescription>
          </Alert>
        ) : null}
        <FormSection
          title="Notice periods"
          description="When LeaseGuard raises a monitoring event for the property manager. Tenants are never notified about lease expiry, renewal options or guarantees."
          columns={1}
        >
          <TextField control={form.control} name="leaseExpiryNoticeDays" label="Lease expiry notices" description={NOTICE_HINT} inputMode="numeric" required />
          <TextField control={form.control} name="renewalDeadlineWarningDays" label="Renewal notice deadline warnings" description={NOTICE_HINT} inputMode="numeric" required />
          <TextField control={form.control} name="guaranteeExpiryNoticeDays" label="Bank guarantee expiry notices" description={NOTICE_HINT} inputMode="numeric" required />
        </FormSection>
        <FormSection
          title="Payment reminders"
          description="Days after the statement date at which each reminder is prepared for approval. An active payment arrangement pauses these reminders."
        >
          <NumberField control={form.control} name="initial" label="Initial reminder" suffix="days" min={0} max={365} allowDecimal={false} required />
          <NumberField control={form.control} name="overdue" label="Overdue reminder" suffix="days" min={0} max={365} allowDecimal={false} required />
          <NumberField control={form.control} name="followUp" label="Follow-up reminder" suffix="days" min={0} max={365} allowDecimal={false} required />
          <NumberField
            control={form.control}
            name="installmentReminderLeadDays"
            label="Instalment reminder"
            description="Days before an arrangement instalment is due."
            suffix="days"
            min={0}
            max={60}
            allowDecimal={false}
            required
          />
        </FormSection>
        <FormSection title="Owner summary" description="The weekly portfolio summary sent to property owners on WhatsApp.">
          <SelectField control={form.control} name="ownerSummaryWeekday" label="Day of the week" options={WEEKDAY_OPTIONS} required />
        </FormSection>
        <FormActions submitLabel="Save changes" isSubmitting={form.formState.isSubmitting} />
      </form>
    </Form>
  )
}
