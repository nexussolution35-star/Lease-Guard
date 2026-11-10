import { canReplyToContact, customerServiceWindow } from '@leaseguard/domain'
import { AlertCircle, Clock, Info, Send } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'

import { TextAreaField, zodResolver } from '@/components/forms'
import { DateDisplay } from '@/components/shared'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Form } from '@/components/ui/form'
import { useIsCompanyWriter } from '@/features/account/useActiveRole'
import { describeApiError } from '@/lib/data/apiErrors'

import { useReplyToContact } from '../api/queries'
import type { WhatsAppConversation } from '../api/source'
import { formatRemaining, REPLY_MAX_LENGTH, replyFormSchema, type ReplyFormValues } from '../handover'

/** How often the window countdown refreshes. */
const CLOCK_TICK_MS = 30_000

function useNow(intervalMs: number): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}

/**
 * A free-form reply to the conversation's contact, for company admins and property managers. WhatsApp allows one
 * only within 24 hours of the contact's last message, so the box shows the time left; it is disabled, with the
 * reasons, for tenants (they only receive approved statement and payment messages), outside the window, and when
 * WhatsApp has not shared the contact's number. The rules are @leaseguard/domain's `canReplyToContact`; the API and
 * the delivery worker apply them again.
 */
export function ReplyBox({ conversation }: { conversation: WhatsAppConversation }) {
  const headingId = useId()
  const canWrite = useIsCompanyWriter()
  const now = useNow(CLOCK_TICK_MS)
  const reply = useReplyToContact()
  const form = useForm<ReplyFormValues>({ resolver: zodResolver(replyFormSchema), defaultValues: { body: '' } })
  const serviceWindow = customerServiceWindow(conversation.lastInboundAt, now)
  const eligibility = canReplyToContact(conversation.contact, conversation.lastInboundAt, now)
  const rootError = form.formState.errors.root?.message

  const submit = form.handleSubmit(async ({ body }) => {
    try {
      await reply.mutateAsync({ conversationId: conversation.id, body })
      form.reset({ body: '' })
      toast.success('Reply queued for delivery')
    } catch (failure) {
      form.setError('root', { type: 'server', message: describeApiError(failure, 'The reply could not be sent. Try again.') })
    }
  })

  return (
    <section aria-labelledby={headingId} className="space-y-3 border-t border-border pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={headingId} className="text-sm font-medium text-foreground">
          Reply
        </h3>
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <Clock aria-hidden="true" className="size-3.5" />
          {serviceWindow.open && serviceWindow.closesAt ? (
            <span>
              Reply window: {formatRemaining(serviceWindow.remainingMs)} left (closes <DateDisplay value={serviceWindow.closesAt} style="datetime" />)
            </span>
          ) : (
            <span>Reply window closed</span>
          )}
        </p>
      </div>
      {!eligibility.eligible ? (
        <Alert>
          <Info aria-hidden="true" />
          <AlertDescription>
            <ul className="list-disc space-y-1 pl-4">
              {eligibility.reasons.map((reason) => (
                <li key={reason}>{reason}.</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
      {canWrite ? null : <p className="text-sm text-muted-foreground">Only company admins and property managers can reply.</p>}
      {rootError ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>{rootError}</AlertDescription>
        </Alert>
      ) : null}
      <Form {...form}>
        <form onSubmit={(event) => void submit(event)} noValidate className="space-y-2">
          <TextAreaField
            control={form.control}
            name="body"
            label="Message"
            description="Sent on WhatsApp from this conversation's number. Never include banking details."
            maxLength={REPLY_MAX_LENGTH}
            rows={3}
            disabled={!canWrite || !eligibility.eligible}
          />
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={!canWrite || !eligibility.eligible || form.formState.isSubmitting}>
              <Send aria-hidden="true" />
              Send reply
            </Button>
          </div>
        </form>
      </Form>
    </section>
  )
}
