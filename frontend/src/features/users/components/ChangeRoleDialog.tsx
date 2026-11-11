import { USER_ROLES, type UserRole } from '@leaseguard/domain'
import { AlertCircle } from 'lucide-react'
import { useEffect } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'

import { SelectField, zodResolver } from '@/components/forms'
import { FormDialog } from '@/components/shared'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Form } from '@/components/ui/form'
import { labelFor } from '@/lib/labels'

import { useUpdateMemberRole } from '../api/queries'
import type { CompanyMember } from '../api/source'
import { memberActionError } from '../memberErrors'
import { ROLE_DESCRIPTIONS, ROLE_OPTIONS } from '../roles'

const changeRoleSchema = z.object({ role: z.enum(USER_ROLES, { error: 'Choose a role' }) })
type ChangeRoleForm = z.infer<typeof changeRoleSchema>

export interface ChangeRoleDialogProps {
  /** The member whose role changes; null closes the dialog. */
  member: CompanyMember | null
  currentRole: UserRole | undefined
  onClose: () => void
}

/** Company admins change another member's role. A refusal (yourself, the last admin) is explained in the dialog. */
export function ChangeRoleDialog({ member, currentRole, onClose }: ChangeRoleDialogProps) {
  const update = useUpdateMemberRole()
  const form = useForm<ChangeRoleForm>({ resolver: zodResolver(changeRoleSchema), defaultValues: { role: currentRole ?? 'read_only' } })
  const { reset } = form
  useEffect(() => {
    if (member && currentRole) reset({ role: currentRole })
  }, [member, currentRole, reset])
  const role = useWatch({ control: form.control, name: 'role' })

  const rootError = form.formState.errors.root?.message
  const submit = form.handleSubmit(async (values) => {
    if (!member) return
    if (values.role === currentRole) {
      onClose()
      return
    }
    try {
      await update.mutateAsync({ userId: member.id, role: values.role })
      toast.success(`${member.fullName} is now ${labelFor(values.role)}.`)
      onClose()
    } catch (error) {
      form.setError('root', { type: 'server', message: memberActionError('role', error).description })
    }
  })

  return (
    <FormDialog
      open={member !== null}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={member ? `Change role for ${member.fullName}` : 'Change role'}
      description="The new role applies in this workspace only, from their next request."
      submitLabel="Change role"
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
        <SelectField control={form.control} name="role" label="Role" required options={ROLE_OPTIONS} description={ROLE_DESCRIPTIONS[role]} />
      </Form>
    </FormDialog>
  )
}
