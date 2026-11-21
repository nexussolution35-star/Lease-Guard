import { type Statement, type StatementListItem } from '@leaseguard/domain'
import { AlertCircle } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'

import { SelectField, zodResolver } from '@/components/forms'
import { FormDialog } from '@/components/shared'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Form } from '@/components/ui/form'
import { describeApiError } from '@/lib/data/apiErrors'
import { MAX_LIST_PAGE_SIZE } from '@/lib/data/listParams'

import { useMarkStatementDuplicate, useStatementList } from '../../api/queries'
import { useDateFormatter } from '@/lib/dateFormat'

const schema = z.object({ duplicateOfStatementId: z.string({ error: 'Choose the statement this one repeats' }).min(1, 'Choose the statement this one repeats') })
type Values = z.infer<typeof schema>

/** How a statement reads in the list of candidates: file, number, tenant and period. */
function describe(statement: StatementListItem, formatDate: (iso: string) => string): string {
  const parts = [statement.file.fileName]
  if (statement.statementNumber) parts.push(`No. ${statement.statementNumber}`)
  if (statement.tenantName) parts.push(statement.tenantName)
  if (statement.periodStart && statement.periodEnd) parts.push(`${formatDate(statement.periodStart)} – ${formatDate(statement.periodEnd)}`)
  return parts.join(' · ')
}

export interface MarkDuplicateDialogProps {
  statement: Statement
  onClose: () => void
}

/**
 * Marks the statement as a duplicate of another statement of the same property. Rejected statements and other
 * duplicates are not offered (the API refuses them too). A duplicate never counts for monitoring. Mounted only while open.
 */
export function MarkDuplicateDialog({ statement, onClose }: MarkDuplicateDialogProps) {
  const { date: formatDate } = useDateFormatter()
  const mark = useMarkStatementDuplicate(statement.id)
  const others = useStatementList({ page: 1, pageSize: MAX_LIST_PAGE_SIZE, propertyId: statement.propertyId, sort: 'uploadedAt', direction: 'desc' })
  const options = (others.data?.items ?? [])
    .filter((other) => other.id !== statement.id && other.status !== 'rejected' && other.status !== 'duplicate')
    .map((other) => ({ value: other.id, label: describe(other, formatDate) }))
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { duplicateOfStatementId: '' } })

  const submit = form.handleSubmit(async ({ duplicateOfStatementId }) => {
    try {
      await mark.mutateAsync(duplicateOfStatementId)
      toast.success(`${statement.file.fileName} marked as a duplicate`)
      onClose()
    } catch (error) {
      form.setError('root', { type: 'server', message: describeApiError(error, 'The statement was not marked. Try again.') })
    }
  })

  return (
    <FormDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title="Mark as a duplicate"
      description="Choose the statement of this property that this one repeats. The duplicate is kept but never counts for monitoring; your name and the time are recorded."
      submitLabel="Mark as duplicate"
      onSubmit={() => submit()}
      isPending={form.formState.isSubmitting}
      submitDisabled={options.length === 0}
    >
      <Form {...form}>
        {form.formState.errors.root?.message ? (
          <Alert variant="destructive">
            <AlertCircle aria-hidden="true" />
            <AlertDescription>{form.formState.errors.root.message}</AlertDescription>
          </Alert>
        ) : null}
        {others.isSuccess && options.length === 0 ? (
          <p className="text-sm text-muted-foreground">No other statement of this property can be chosen.</p>
        ) : (
          <SelectField
            control={form.control}
            name="duplicateOfStatementId"
            label="Duplicate of"
            options={options}
            required
            placeholder={others.isPending ? 'Loading statements…' : 'Choose the statement'}
          />
        )}
      </Form>
    </FormDialog>
  )
}
