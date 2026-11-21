import { ARRANGEMENT_CLOSE_OUTCOMES, type ArrangementCloseOutcome, type PaymentArrangementListItem } from '@leaseguard/domain'
import { AlertCircle } from 'lucide-react'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'

import { RadioGroupField, TextAreaField, zodResolver, type FieldOption } from '@/components/forms'
import { FormDialog } from '@/components/shared'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Form } from '@/components/ui/form'
import { describeApiError } from '@/lib/data/apiErrors'

import { useCloseArrangement } from '../api/queries'

export interface CloseArrangementDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  arrangement: PaymentArrangementListItem
}

const OUTCOME_TEXT: Readonly<Record<ArrangementCloseOutcome, Omit<FieldOption<ArrangementCloseOutcome>, 'value'>>> = {
  completed: { label: 'Completed', description: 'The tenant paid the balance as agreed.' },
  defaulted: { label: 'Defaulted', description: 'The tenant did not keep to the arrangement.' },
}
const OUTCOME_OPTIONS = ARRANGEMENT_CLOSE_OUTCOMES.map((value) => ({ value, ...OUTCOME_TEXT[value] }))

const closeSchema = z.object({
  outcome: z.enum(ARRANGEMENT_CLOSE_OUTCOMES, { error: 'Choose how the arrangement ended' }),
  reason: z.string().trim().max(1000, 'Use at most 1000 characters'),
})
type CloseInput = z.input<typeof closeSchema>
type CloseValues = z.output<typeof closeSchema>

/**
 * Close an active arrangement as completed or defaulted, with an optional note. The record becomes read-only and the
 * tenant's normal arrears reminders resume (the database applies both). Nothing is paid or refunded here.
 */
export function CloseArrangementDialog({ open, onOpenChange, arrangement }: CloseArrangementDialogProps) {
  const close = useCloseArrangement()
  const form = useForm<CloseInput, unknown, CloseValues>({
    resolver: zodResolver(closeSchema),
    defaultValues: { outcome: undefined as unknown as ArrangementCloseOutcome, reason: '' },
  })
  const { reset } = form

  useEffect(() => {
    if (open) reset({ outcome: undefined as unknown as ArrangementCloseOutcome, reason: '' })
  }, [open, reset])

  const submit = form.handleSubmit(async ({ outcome, reason }) => {
    try {
      await close.mutateAsync({ id: arrangement.id, closing: { outcome, ...(reason === '' ? {} : { reason }) } })
      toast.success(`Arrangement with ${arrangement.tenantName} closed as ${OUTCOME_TEXT[outcome].label.toLowerCase()}`)
      onOpenChange(false)
    } catch (error) {
      form.setError('root', { type: 'server', message: describeApiError(error, 'The arrangement could not be closed. Try again.') })
    }
  })

  const rootError = form.formState.errors.root?.message
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title={`Close the arrangement with ${arrangement.tenantName}?`}
      description="The arrangement becomes read-only and the tenant's normal arrears reminders resume."
      submitLabel="Close arrangement"
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
        <RadioGroupField control={form.control} name="outcome" label="How did it end?" options={OUTCOME_OPTIONS} required />
        <TextAreaField control={form.control} name="reason" label="Note" rows={3} maxLength={1000} />
      </Form>
    </FormDialog>
  )
}
