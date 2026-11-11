import { AlertCircle } from 'lucide-react'
import { useEffect } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { toast } from 'sonner'

import { SelectField, TextField, zodResolver } from '@/components/forms'
import { FormDialog } from '@/components/shared'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Form } from '@/components/ui/form'

import { useCreateInvitation } from '../api/queries'
import { INVITE_FORM_DEFAULTS, inviteFormSchema, newInvitationFrom, type InviteFormInput, type InviteFormValues } from '../inviteSchema'
import { inviteError } from '../memberErrors'
import { ROLE_DESCRIPTIONS, ROLE_OPTIONS } from '../roles'

/**
 * Company admins invite someone by email with a role. The API records a pending invitation and the worker emails it
 * through Supabase Auth; the invitee joins only by accepting while signed in with that email. A conflict (an open
 * invitation, or the email already belongs to a member) is shown on the email field.
 */
export function InviteUserDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const create = useCreateInvitation()
  const form = useForm<InviteFormInput, unknown, InviteFormValues>({ resolver: zodResolver(inviteFormSchema), defaultValues: INVITE_FORM_DEFAULTS })
  const { reset } = form
  useEffect(() => {
    if (open) reset(INVITE_FORM_DEFAULTS)
  }, [open, reset])
  const role = useWatch({ control: form.control, name: 'role' })

  const rootError = form.formState.errors.root?.message
  const submit = form.handleSubmit(async (values) => {
    try {
      const invitation = await create.mutateAsync(newInvitationFrom(values))
      toast.success(`Invitation for ${invitation.email} created. LeaseGuard emails it in a moment.`)
      onOpenChange(false)
    } catch (error) {
      const copy = inviteError(error)
      form.setError(copy.field, { type: 'server', message: copy.message }, { shouldFocus: copy.field === 'email' })
    }
  })

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Invite user"
      description="They receive an email invitation and join this workspace once they accept it while signed in with this email address."
      submitLabel="Send invitation"
      onSubmit={() => submit()}
      isPending={form.formState.isSubmitting}
      size="sm"
    >
      <Form {...form}>
        {rootError ? (
          <Alert variant="destructive">
            <AlertCircle aria-hidden="true" />
            <AlertDescription>{rootError}</AlertDescription>
          </Alert>
        ) : null}
        <TextField control={form.control} name="email" label="Email address" type="email" inputMode="email" autoComplete="off" required />
        <TextField control={form.control} name="fullName" label="Name" description="Optional. Used to greet them in the email." autoComplete="off" />
        <SelectField
          control={form.control}
          name="role"
          label="Role"
          required
          options={ROLE_OPTIONS}
          description={role ? ROLE_DESCRIPTIONS[role] : undefined}
        />
      </Form>
    </FormDialog>
  )
}
