import {
  formatZAR,
  INSTALLMENT_OUTCOMES,
  installmentOutcomeProblem,
  isInstallmentOutcome,
  isoToday,
  type ArrangementInstallment,
  type InstallmentOutcome,
  type PaymentArrangementListItem,
} from '@leaseguard/domain'
import { AlertCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'

import { RadioGroupField, TextAreaField, zodResolver, type FieldOption } from '@/components/forms'
import { FormDialog } from '@/components/shared'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Form } from '@/components/ui/form'
import { describeApiError } from '@/lib/data/apiErrors'

import { useRecordInstallmentOutcome } from '../api/queries'
import { useDateFormatter } from '@/lib/dateFormat'

export interface InstallmentOutcomeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  arrangement: PaymentArrangementListItem
  /** The instalment to record; the dialog renders nothing without one. */
  installment: ArrangementInstallment | null
}

type OutcomeChoice = InstallmentOutcome | 'scheduled'
const OUTCOME_CHOICES = [...INSTALLMENT_OUTCOMES, 'scheduled'] as const satisfies readonly OutcomeChoice[]

const OUTCOME_TEXT: Readonly<Record<OutcomeChoice, { label: string; description: string }>> = {
  confirmed_paid: { label: 'Paid', description: 'You confirmed the tenant paid it, from a statement or with the tenant.' },
  missed: { label: 'Missed', description: 'It was due and was not paid.' },
  waived: { label: 'Waived', description: 'The owner agreed the tenant need not pay it.' },
  scheduled: { label: 'Clear the recorded outcome', description: 'Back to scheduled, as if nothing was recorded.' },
}

const outcomeSchema = z.object({
  outcome: z.enum(OUTCOME_CHOICES, { error: 'Choose what happened to the instalment' }),
  note: z.string().trim().max(1000, 'Use at most 1000 characters'),
})
type OutcomeInput = z.input<typeof outcomeSchema>
type OutcomeValues = z.output<typeof outcomeSchema>

/**
 * Record what the property manager confirms happened to one instalment: paid, missed or waived, or clear what was
 * recorded. LeaseGuard does not see or verify payments; this is the manager's record. Which outcomes are possible is
 * the domain's `installmentOutcomeProblem` (an instalment not yet due cannot be missed); the database checks it again.
 */
export function InstallmentOutcomeDialog({ open, onOpenChange, arrangement, installment }: InstallmentOutcomeDialogProps) {
  const { date: formatDate } = useDateFormatter()
  const record = useRecordInstallmentOutcome()
  const form = useForm<OutcomeInput, unknown, OutcomeValues>({
    resolver: zodResolver(outcomeSchema),
    defaultValues: { outcome: undefined as unknown as OutcomeChoice, note: '' },
  })
  const { reset } = form
  const [today] = useState(() => isoToday(new Date()))

  useEffect(() => {
    if (open) reset({ outcome: undefined as unknown as OutcomeChoice, note: installment?.notes ?? '' })
  }, [open, installment, reset])

  if (!installment) return null
  const hasOutcome = isInstallmentOutcome(installment.status)
  const options: FieldOption<OutcomeChoice>[] = OUTCOME_CHOICES.filter((choice) => choice !== 'scheduled' || hasOutcome).map((choice) => {
    const problem = installmentOutcomeProblem(arrangement, installment, choice, today)
    return {
      value: choice,
      label: OUTCOME_TEXT[choice].label,
      description: problem ?? OUTCOME_TEXT[choice].description,
      disabled: problem !== null || choice === installment.status,
    }
  })

  const submit = form.handleSubmit(async ({ outcome, note }) => {
    try {
      await record.mutateAsync({
        id: arrangement.id,
        installmentId: installment.id,
        outcome: { outcome, ...(note === '' || outcome === 'scheduled' ? {} : { note }) },
      })
      toast.success(
        outcome === 'scheduled'
          ? `Instalment ${installment.sequence} is back to scheduled`
          : `Instalment ${installment.sequence} recorded as ${OUTCOME_TEXT[outcome].label.toLowerCase()}`,
      )
      onOpenChange(false)
    } catch (error) {
      form.setError('root', { type: 'server', message: describeApiError(error, 'The outcome could not be recorded. Try again.') })
    }
  })

  const rootError = form.formState.errors.root?.message
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title={`Instalment ${installment.sequence}`}
      description={`${formatZAR(installment.amount)} due ${formatDate(installment.dueDate)}. LeaseGuard records what you confirm; it does not see or verify payments.`}
      submitLabel="Record outcome"
      onSubmit={() => submit()}
      isPending={form.formState.isSubmitting}
    >
      <Form {...form}>
        {rootError ? (
          <Alert variant="destructive">
            <AlertCircle aria-hidden="true" />
            <AlertDescription>{rootError}</AlertDescription>
          </Alert>
        ) : null}
        <RadioGroupField control={form.control} name="outcome" label="What happened?" options={options} required />
        <TextAreaField control={form.control} name="note" label="Note" description="For example, the statement it shows on." rows={3} maxLength={1000} />
      </Form>
    </FormDialog>
  )
}
