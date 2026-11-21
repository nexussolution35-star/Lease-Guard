import type { MonitoringEventTargetStatus } from '@leaseguard/api-client'
import { EVENT_STATUS_NOTE_MAX_LENGTH, statusChangeRequiresNote, type MonitoringEventListItem } from '@leaseguard/domain'
import { AlertCircle } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'

import { TextAreaField, zodResolver } from '@/components/forms'
import { FormDialog } from '@/components/shared'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Form } from '@/components/ui/form'
import { describeApiError } from '@/lib/data/apiErrors'
import { labelFor } from '@/lib/labels'

import { useUpdateMonitoringEventStatus } from '../api/queries'
import { STATUS_ACTIONS } from '../eventPresentation'

export interface StatusChangeDialogProps {
  event: MonitoringEventListItem
  /** The status to move to: one of the domain workflow's next statuses for the event. */
  to: MonitoringEventTargetStatus
  onClose: () => void
}

/** The note is required when the domain says the move needs one (dismissing), and optional otherwise. */
function schemaFor(to: MonitoringEventTargetStatus) {
  const note = z.string().trim().max(EVENT_STATUS_NOTE_MAX_LENGTH, `Keep it under ${EVENT_STATUS_NOTE_MAX_LENGTH} characters`)
  return z.object({ note: statusChangeRequiresNote(to) ? note.min(1, 'Say why the event is dismissed') : note })
}
type Values = z.infer<ReturnType<typeof schemaFor>>

/**
 * Moves one event to another status through the API, with an optional note (required, as the reason, to dismiss). The
 * API applies the workflow again and records who made the change and when. A refusal (the move is no longer allowed,
 * or someone changed the event meanwhile) is shown in the dialog. Mounted only while open; a stray click outside never
 * closes it.
 */
export function StatusChangeDialog({ event, to, onClose }: StatusChangeDialogProps) {
  const update = useUpdateMonitoringEventStatus()
  const action = STATUS_ACTIONS[to]
  const required = statusChangeRequiresNote(to)
  const form = useForm<Values>({ resolver: zodResolver(schemaFor(to)), defaultValues: { note: '' } })

  const submit = form.handleSubmit(async ({ note }) => {
    try {
      await update.mutateAsync({ id: event.id, change: { status: to, ...(note ? { note } : {}) } })
      toast.success(`Event moved to ${labelFor(to).toLowerCase()}`)
      onClose()
    } catch (error) {
      form.setError('root', { type: 'server', message: describeApiError(error, 'The status was not changed. Try again.') })
    }
  })

  return (
    <FormDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={action.title}
      description={action.description}
      submitLabel={action.label}
      onSubmit={() => submit()}
      isPending={form.formState.isSubmitting}
    >
      <Form {...form}>
        {form.formState.errors.root?.message ? (
          <Alert variant="destructive">
            <AlertCircle aria-hidden="true" />
            <AlertDescription>{form.formState.errors.root.message}</AlertDescription>
          </Alert>
        ) : null}
        <TextAreaField
          control={form.control}
          name="note"
          label={required ? 'Reason' : 'Note'}
          description={
            required
              ? 'Why the finding needs no action. It is kept with the event and its history.'
              : 'Optional. What was checked or done; it is kept with the event and its history.'
          }
          required={required}
          rows={4}
          maxLength={EVENT_STATUS_NOTE_MAX_LENGTH}
        />
      </Form>
    </FormDialog>
  )
}
