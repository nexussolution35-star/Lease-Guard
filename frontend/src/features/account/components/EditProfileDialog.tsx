import { AlertCircle } from 'lucide-react'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'

import { PhoneNumberField, TextField, zodResolver } from '@/components/forms'
import { FormDialog } from '@/components/shared'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Form } from '@/components/ui/form'

import { useUpdateProfile } from '../api/queries'
import type { CurrentUserProfile } from '../api/source'
import {
  profileChangesFrom,
  profileFormDefaults,
  profileFormSchema,
  type ProfileFormInput,
  type ProfileFormValues,
} from '../profileSchema'

export interface EditProfileDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  profile: CurrentUserProfile
}

const FALLBACK_ERROR = 'Your profile could not be saved. Try again.'

/** The signed-in user's own profile: full name, phone, WhatsApp number and job title (`PATCH /me`). */
export function EditProfileDialog({ open, onOpenChange, profile }: EditProfileDialogProps) {
  const update = useUpdateProfile()
  const form = useForm<ProfileFormInput, unknown, ProfileFormValues>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: profileFormDefaults(profile),
  })
  const { reset } = form

  // Start from the saved profile every time the dialog opens.
  useEffect(() => {
    if (open) reset(profileFormDefaults(profile))
  }, [open, profile, reset])

  const rootError = form.formState.errors.root?.message

  const submit = form.handleSubmit(async (values) => {
    try {
      await update.mutateAsync(profileChangesFrom(values))
      toast.success('Profile updated')
      onOpenChange(false)
    } catch (error) {
      form.setError('root', { type: 'server', message: error instanceof Error && error.message ? error.message : FALLBACK_ERROR })
    }
  })

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Edit profile"
      description="How you appear to colleagues in LeaseGuard. Your email address is managed by your administrator."
      submitLabel="Save changes"
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
        <TextField control={form.control} name="fullName" label="Full name" autoComplete="name" maxLength={120} required />
        <TextField control={form.control} name="jobTitle" label="Job title" autoComplete="organization-title" maxLength={100} />
        <TextField control={form.control} name="phone" label="Phone" autoComplete="tel" inputMode="tel" maxLength={30} />
        <PhoneNumberField
          control={form.control}
          name="whatsappNumber"
          label="WhatsApp number"
          description="International format, e.g. +27 82 123 4567. Leave empty to remove it."
          placeholder="+27 82 123 4567"
        />
      </Form>
    </FormDialog>
  )
}
