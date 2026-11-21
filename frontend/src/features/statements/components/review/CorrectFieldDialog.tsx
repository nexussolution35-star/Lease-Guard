import { extractionFieldKind, parseFieldCorrection, type ExtractedField } from '@leaseguard/domain'
import { AlertCircle } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'

import { CurrencyField, DateField, TextField, zodResolver } from '@/components/forms'
import { FormDialog } from '@/components/shared'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Form } from '@/components/ui/form'
import { describeApiError } from '@/lib/data/apiErrors'
import { labelFor } from '@/lib/labels'

import { useCorrectStatementField } from '../../api/queries'

interface CorrectionValues {
  text?: string
  date?: string
  amount?: number
}

export interface CorrectFieldDialogProps {
  statementId: string
  field: ExtractedField
  onClose: () => void
}

/**
 * Enters the correct value of one field, read from the original statement. The input matches the field (text, date or
 * rands) and the value is checked by the same domain rule as the API (`parseFieldCorrection`). The extracted value is
 * kept beside the correction; who entered it and when are recorded. Mounted only while open.
 */
export function CorrectFieldDialog({ statementId, field, onClose }: CorrectFieldDialogProps) {
  const correct = useCorrectStatementField(statementId)
  const kind = extractionFieldKind(field.name)
  const label = labelFor(field.name)
  // Starts from the value on record (the correction, else what was extracted); a value never found starts empty.
  const current = field.correctedValue ?? field.value

  const schema = z
    .object({ text: z.string().optional(), date: z.string().optional(), amount: z.number().optional() })
    .superRefine((values, ctx) => {
      const input = kind === 'text' ? values.text : kind === 'date' ? values.date : values.amount
      const parsed = parseFieldCorrection(field.name, input ?? (kind === 'amount' ? undefined : ''))
      if (!parsed.ok) ctx.addIssue({ code: 'custom', path: [kind], message: parsed.message })
    })

  const form = useForm<CorrectionValues>({
    resolver: zodResolver(schema),
    defaultValues:
      kind === 'text'
        ? { text: typeof current === 'string' ? current : '' }
        : kind === 'date'
          ? typeof current === 'string'
            ? { date: current }
            : {}
          : typeof current === 'number'
            ? { amount: current }
            : {},
  })

  const submit = form.handleSubmit(async (values) => {
    const parsed = parseFieldCorrection(field.name, kind === 'text' ? values.text : kind === 'date' ? values.date : values.amount)
    if (!parsed.ok) return
    try {
      await correct.mutateAsync({ field: field.name, value: parsed.value })
      toast.success(`${label} saved`)
      onClose()
    } catch (error) {
      form.setError('root', { type: 'server', message: describeApiError(error, 'The value was not saved. Try again.') })
    }
  })

  const printed = field.rawText.trim()
  return (
    <FormDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={`${field.value === null && field.correctedValue === undefined ? 'Enter' : 'Correct'} the ${label.toLowerCase()}`}
      description={
        printed === ''
          ? 'Enter the value exactly as the original statement shows it. Your name and the time are recorded with it.'
          : `The statement shows “${printed}”. Enter the value exactly as the original statement shows it. Your name and the time are recorded with it.`
      }
      submitLabel="Save value"
      onSubmit={() => submit()}
      isPending={form.formState.isSubmitting}
      size="sm"
    >
      <Form {...form}>
        {form.formState.errors.root?.message ? (
          <Alert variant="destructive">
            <AlertCircle aria-hidden="true" />
            <AlertDescription>{form.formState.errors.root.message}</AlertDescription>
          </Alert>
        ) : null}
        {kind === 'text' ? (
          <TextField control={form.control} name="text" label={label} required maxLength={200} />
        ) : kind === 'date' ? (
          <DateField control={form.control} name="date" label={label} required clearable={false} yearDropdown />
        ) : (
          <CurrencyField control={form.control} name="amount" label={`${label} (ZAR)`} required allowNegative />
        )}
      </Form>
    </FormDialog>
  )
}
