import { useEffect, useMemo } from 'react'
import { AlertCircle } from 'lucide-react'
import { useForm, useWatch } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { isWhatsAppTestRecipient } from '@leaseguard/domain'

import { SelectField, TextField, zodResolver } from '@/components/forms'
import { normaliseSAPhoneNumber } from '@/components/forms/phone'
import { FormDialog } from '@/components/shared'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Form } from '@/components/ui/form'

import { useSendWhatsAppTestMessage, useWhatsAppBusinessAccounts, useWhatsAppMessageTemplates } from '../api/queries'

/** A South African number as typed (082 123 4567) or any international number (+44 20 …), stored as E.164. */
const recipient = z
  .string()
  .trim()
  .min(1, 'Enter the WhatsApp number to send the test to')
  .transform((value) => normaliseSAPhoneNumber(value) ?? value.replace(/[\s().-]/g, ''))
  .refine(isWhatsAppTestRecipient, 'Enter a WhatsApp number, e.g. 082 123 4567 or +27 82 123 4567')

const testMessageSchema = z.object({
  numberId: z.string().min(1, 'Choose the number to send from'),
  templateId: z.string().min(1, 'Choose an approved template'),
  to: recipient,
})
type TestMessageForm = z.input<typeof testMessageSchema>

/**
 * Company admins: send an approved Meta template from a connected number to their own WhatsApp number. Only connected
 * numbers and the APPROVED templates of the chosen number's account are offered; the API checks both again and refuses
 * a tenant's number. The setup step completes only when Meta reports the message delivered.
 */
export function TestMessageDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const accounts = useWhatsAppBusinessAccounts()
  const templates = useWhatsAppMessageTemplates()
  const send = useSendWhatsAppTestMessage()
  const form = useForm<TestMessageForm, unknown, z.output<typeof testMessageSchema>>({
    resolver: zodResolver(testMessageSchema),
    defaultValues: { numberId: '', templateId: '', to: '' },
  })
  const { reset, setValue } = form
  useEffect(() => reset({ numberId: '', templateId: '', to: '' }), [open, reset])

  const numbers = useMemo(
    () => (accounts.data ?? []).flatMap((account) => account.numbers).filter((number) => number.connectionStatus === 'connected'),
    [accounts.data],
  )
  const numberId = useWatch({ control: form.control, name: 'numberId' })
  const chosen = numbers.find((number) => number.id === numberId)
  const approved = useMemo(
    () => (templates.data ?? []).filter((t) => t.status === 'APPROVED' && chosen !== undefined && t.businessAccountId === chosen.businessAccountId),
    [templates.data, chosen],
  )
  // A template of another account cannot be sent from the newly chosen number.
  useEffect(() => setValue('templateId', ''), [numberId, setValue])

  const rootError = form.formState.errors.root?.message
  const submit = form.handleSubmit(async (values) => {
    try {
      await send.mutateAsync(values)
      toast.success('Test message queued. The step completes when Meta reports it delivered.')
      onOpenChange(false)
    } catch (error) {
      form.setError('root', { type: 'server', message: error instanceof Error && error.message ? error.message : 'The test message could not be sent. Try again.' })
    }
  })

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Send a test message"
      description="LeaseGuard sends an approved WhatsApp template from your connected number. Use your own number: tenants never receive test messages."
      submitLabel="Send test message"
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
        <SelectField
          control={form.control}
          name="numberId"
          label="Send from"
          required
          placeholder={numbers.length === 0 ? 'No connected number' : 'Choose a number'}
          options={numbers.map((number) => ({ value: number.id, label: `${number.displayNumber || number.phoneNumberId} (${number.verifiedName ?? number.displayName})` }))}
        />
        <SelectField
          control={form.control}
          name="templateId"
          label="Approved template"
          required
          disabled={!chosen}
          placeholder={chosen && approved.length === 0 ? 'No approved template for this number' : 'Choose a template'}
          options={approved.map((template) => ({ value: template.id, label: `${template.name} (${template.language})` }))}
          description="Choose a template without placeholders, such as Meta’s hello_world: test messages are sent without parameters."
        />
        <TextField control={form.control} name="to" label="Your WhatsApp number" inputMode="tel" autoComplete="tel" placeholder="082 123 4567" required />
      </Form>
    </FormDialog>
  )
}
