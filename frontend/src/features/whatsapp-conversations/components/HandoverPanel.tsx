import { AlertCircle, CheckCircle2, Hand, UserPlus } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'

import { SelectField, TextAreaField, zodResolver } from '@/components/forms'
import { FormDialog } from '@/components/shared'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Form } from '@/components/ui/form'
import { useCurrentUserId, useIsCompanyWriter } from '@/features/account/useActiveRole'
import { useMemberList } from '@/features/users/api/queries'
import { describeApiError } from '@/lib/data/apiErrors'
import { MAX_LIST_PAGE_SIZE } from '@/lib/data/listParams'

import { useAcceptHandover, useAssignHandover, useResolveHandover } from '../api/queries'
import type { WhatsAppConversation } from '../api/source'
import { assignableMembers, handoverStatusText } from '../handover'

/**
 * Who handles a conversation, and (for company admins and property managers) taking it over, handing it to a
 * colleague and resolving it. The API enforces the same rules; read-only members only see the status.
 */
export function HandoverPanel({ conversation }: { conversation: WhatsAppConversation }) {
  const headingId = useId()
  const canWrite = useIsCompanyWriter()
  const currentUserId = useCurrentUserId()
  const accept = useAcceptHandover()
  const [dialog, setDialog] = useState<'assign' | 'resolve' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { handover } = conversation
  const takenByMe = handover?.status === 'accepted' && handover.assignedUserId === currentUserId
  const takenByOther = handover?.status === 'accepted' && !takenByMe

  const takeOver = async () => {
    setError(null)
    try {
      await accept.mutateAsync({ conversationId: conversation.id })
      toast.success('You have taken this conversation over')
    } catch (failure) {
      setError(describeApiError(failure, 'The conversation could not be taken over. Try again.'))
    }
  }

  return (
    <section aria-labelledby={headingId} className="space-y-2 rounded-md border border-border p-3">
      <h3 id={headingId} className="text-sm font-medium text-foreground">
        Handover
      </h3>
      {handover ? (
        <div className="space-y-1 text-sm">
          <p className="font-medium text-foreground">{handoverStatusText(handover, currentUserId)}</p>
          <p className="text-muted-foreground">Reason: {handover.reason}</p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No one has taken this conversation over.</p>
      )}
      {error ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {canWrite ? (
        <div className="flex flex-wrap gap-2">
          {takenByMe || takenByOther ? null : (
            <Button type="button" size="sm" onClick={() => void takeOver()} disabled={accept.isPending}>
              <Hand aria-hidden="true" />
              {handover?.assignedUserId === currentUserId && currentUserId !== null ? 'Accept' : 'Take over'}
            </Button>
          )}
          <Button type="button" size="sm" variant="outline" onClick={() => setDialog('assign')}>
            <UserPlus aria-hidden="true" />
            Assign
          </Button>
          {handover ? (
            <Button type="button" size="sm" variant="outline" onClick={() => setDialog('resolve')}>
              <CheckCircle2 aria-hidden="true" />
              Resolve
            </Button>
          ) : null}
        </div>
      ) : null}
      {canWrite ? (
        <>
          <AssignDialog open={dialog === 'assign'} onOpenChange={(open) => setDialog(open ? 'assign' : null)} conversation={conversation} />
          <ResolveDialog open={dialog === 'resolve'} onOpenChange={(open) => setDialog(open ? 'resolve' : null)} conversation={conversation} />
        </>
      ) : null}
    </section>
  )
}

const assignSchema = z.object({ userId: z.string().min(1, 'Choose who handles the conversation') })
type AssignValues = z.infer<typeof assignSchema>

function AssignDialog({ open, onOpenChange, conversation }: { open: boolean; onOpenChange: (open: boolean) => void; conversation: WhatsAppConversation }) {
  const assign = useAssignHandover()
  const currentUserId = useCurrentUserId()
  const members = useMemberList({ page: 1, pageSize: MAX_LIST_PAGE_SIZE })
  const form = useForm<AssignValues>({ resolver: zodResolver(assignSchema), defaultValues: { userId: '' } })
  const { reset } = form
  useEffect(() => {
    if (open) reset({ userId: conversation.handover?.assignedUserId ?? '' })
  }, [open, conversation.handover?.assignedUserId, reset])

  const options = assignableMembers(members.data?.items ?? [], conversation.companyId).map((member) => ({
    value: member.id,
    label: member.id === currentUserId ? `${member.fullName} (you)` : member.fullName,
  }))
  const rootError = form.formState.errors.root?.message

  const submit = form.handleSubmit(async ({ userId }) => {
    try {
      await assign.mutateAsync({ conversationId: conversation.id, userId })
      toast.success('Conversation assigned')
      onOpenChange(false)
    } catch (failure) {
      form.setError('root', { type: 'server', message: describeApiError(failure, 'The conversation could not be assigned. Try again.') })
    }
  })

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Assign conversation"
      description="Hand this conversation to a company admin or property manager. It stays waiting until they accept it; assigning it to yourself takes it over."
      submitLabel="Assign"
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
        {members.isError ? (
          <Alert variant="destructive">
            <AlertCircle aria-hidden="true" />
            <AlertDescription>{describeApiError(members.error, 'The team could not be loaded. Try again.')}</AlertDescription>
          </Alert>
        ) : null}
        <SelectField
          control={form.control}
          name="userId"
          label="Assign to"
          options={options}
          placeholder={members.isPending ? 'Loading the team…' : 'Choose a person'}
          required
        />
      </Form>
    </FormDialog>
  )
}

const resolveSchema = z.object({ note: z.string().max(1000, 'At most 1 000 characters') })
type ResolveValues = z.infer<typeof resolveSchema>

function ResolveDialog({ open, onOpenChange, conversation }: { open: boolean; onOpenChange: (open: boolean) => void; conversation: WhatsAppConversation }) {
  const resolve = useResolveHandover()
  const form = useForm<ResolveValues>({ resolver: zodResolver(resolveSchema), defaultValues: { note: '' } })
  const { reset } = form
  useEffect(() => {
    if (open) reset({ note: '' })
  }, [open, reset])
  const rootError = form.formState.errors.root?.message

  const submit = form.handleSubmit(async ({ note }) => {
    try {
      const trimmed = note.trim()
      await resolve.mutateAsync({ conversationId: conversation.id, ...(trimmed ? { note: trimmed } : {}) })
      toast.success('Handover resolved')
      onOpenChange(false)
    } catch (failure) {
      form.setError('root', { type: 'server', message: describeApiError(failure, 'The handover could not be resolved. Try again.') })
    }
  })

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Resolve handover"
      description="The conversation no longer needs a person. It stays in the inbox."
      submitLabel="Resolve"
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
        <TextAreaField control={form.control} name="note" label="Note" description="Optional: what was done." maxLength={1000} rows={3} />
      </Form>
    </FormDialog>
  )
}
