import { AlertCircle, CheckCircle2, CircleDashed, CircleMinus, Loader2, RefreshCw, Unplug, KeyRound, TriangleAlert, XCircle } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import type { WhatsAppVerificationStep, WhatsAppVerificationStepStatus } from '@leaseguard/api-client'

import { TextField, zodResolver } from '@/components/forms'
import { ConfirmationDialog, DateDisplay, FormDialog } from '@/components/shared'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Form } from '@/components/ui/form'
import { TONE_CLASSES } from '@/lib/labels'
import { cn } from '@/lib/utils'

import { isNumberVerificationRunning, useDisconnectWhatsAppNumber, useRegisterWhatsAppNumber, useVerifyWhatsAppNumber } from '../api/queries'
import type { WhatsAppPhoneNumber, WhatsAppVerificationStepResult } from '../api/source'

/** The checks LeaseGuard makes with Meta, in order, named for the admin. */
const STEP_LABELS: Readonly<Record<WhatsAppVerificationStep, string>> = {
  token_scopes: 'Access granted to LeaseGuard',
  phone_number: 'Number found in the WhatsApp Business Account',
  webhook_subscription: 'Messages and delivery updates (webhook)',
  registration: 'Registered for the WhatsApp Cloud API',
  message_templates: 'Message templates synced',
}
const STEP_ORDER = Object.keys(STEP_LABELS) as WhatsAppVerificationStep[]

const STATUS_VIEW: Readonly<
  Record<WhatsAppVerificationStepStatus, { label: string; tone: keyof typeof TONE_CLASSES; icon: typeof CheckCircle2 }>
> = {
  passed: { label: 'Passed', tone: 'success', icon: CheckCircle2 },
  not_required: { label: 'Not required', tone: 'neutral', icon: CircleMinus },
  failed: { label: 'Failed', tone: 'danger', icon: XCircle },
  action_needed: { label: 'Action needed', tone: 'warning', icon: TriangleAlert },
  pending: { label: 'Not checked yet', tone: 'neutral', icon: CircleDashed },
}

function StepItem({ step, result }: { step: WhatsAppVerificationStep; result: WhatsAppVerificationStepResult | undefined }) {
  const view = STATUS_VIEW[result?.status ?? 'pending']
  const Icon = view.icon
  return (
    <li className="flex gap-3 py-2">
      <Icon className={cn('mt-0.5 size-4 shrink-0', view.tone === 'success' && 'text-success', view.tone === 'danger' && 'text-destructive')} aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
          {STEP_LABELS[step]}
          <span className={cn('rounded-md border px-1.5 py-0.5 text-xs font-normal', TONE_CLASSES[view.tone])}>{view.label}</span>
        </p>
        {result?.message ? <p className="text-sm text-muted-foreground">{result.message}</p> : null}
        {result?.recovery && (result.status === 'failed' || result.status === 'action_needed') ? (
          <p className="text-sm text-foreground">
            <span className="font-medium">How to fix: </span>
            {result.recovery}
          </p>
        ) : null}
        {result?.metaErrorCode ? <p className="text-xs text-muted-foreground">Meta error code {result.metaErrorCode}</p> : null}
      </div>
    </li>
  )
}

/** Whether Meta's registration lock (error 133016) still applies, as of when the component mounted. */
function useRegistrationLocked(number: WhatsAppPhoneNumber): boolean {
  const [mountedAt] = useState(() => Date.now())
  return number.registrationBlockedUntil !== undefined && new Date(number.registrationBlockedUntil).getTime() > mountedAt
}

/** Each verification step of a number, in order, with what happened and how to recover. */
export function VerificationSteps({ number }: { number: WhatsAppPhoneNumber }) {
  const titleId = useId()
  const locked = useRegistrationLocked(number)
  if (number.connectionStatus === 'disconnected') {
    return <p className="text-sm text-muted-foreground">Disconnected. Connect the number again with Connect WhatsApp Business to use it.</p>
  }
  const byStep = new Map(number.verificationSteps.map((s) => [s.step, s]))
  const running = isNumberVerificationRunning(number)
  const failed = number.verificationSteps.find((s) => s.status === 'failed')
  return (
    <section aria-labelledby={titleId} className="space-y-1">
      <h4 id={titleId} className="flex items-center gap-2 text-sm font-semibold text-foreground">
        Verification with Meta
        {running ? <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Verification in progress" /> : null}
      </h4>
      {byStep.size === 0 ? (
        <p className="text-sm text-muted-foreground">Waiting for LeaseGuard to start verifying this number with Meta.</p>
      ) : failed ? (
        <p className="text-sm text-destructive">Not connected: “{STEP_LABELS[failed.step]}” failed. The number connects only when every check passes.</p>
      ) : number.connectionStatus === 'connected' ? (
        <p className="text-sm text-muted-foreground">Every check passed, so the number is connected.</p>
      ) : null}
      <ol className="divide-y divide-border" aria-label="Verification steps">
        {STEP_ORDER.map((step) => (
          <StepItem key={step} step={step} result={byStep.get(step)} />
        ))}
      </ol>
      {locked && number.registrationBlockedUntil ? (
        <p className="text-sm text-muted-foreground">
          Meta’s registration lock ends <DateDisplay value={number.registrationBlockedUntil} style="datetime" />.
        </p>
      ) : null}
    </section>
  )
}

const pinSchema = z.object({
  pin: z.string().trim().regex(/^\d{6}$/, 'Enter exactly 6 digits'),
})
type PinForm = z.input<typeof pinSchema>

function RegisterNumberDialog({ number, open, onOpenChange }: { number: WhatsAppPhoneNumber; open: boolean; onOpenChange: (open: boolean) => void }) {
  const register = useRegisterWhatsAppNumber()
  const form = useForm<PinForm, unknown, z.output<typeof pinSchema>>({ resolver: zodResolver(pinSchema), defaultValues: { pin: '' } })
  const { reset } = form
  // The PIN is never kept: the field is cleared whenever the dialog opens or closes.
  useEffect(() => reset({ pin: '' }), [open, reset])
  const rootError = form.formState.errors.root?.message
  const submit = form.handleSubmit(async ({ pin }) => {
    try {
      const result = await register.mutateAsync({ numberId: number.id, pin })
      toast.success(result.message)
      onOpenChange(false)
    } catch (error) {
      form.setError('root', { type: 'server', message: error instanceof Error && error.message ? error.message : 'The number could not be registered. Try again.' })
    }
  })
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Register number"
      description="Meta requires a 6-digit PIN to register the number for the WhatsApp Cloud API. If the number already has two-step verification, enter that PIN; otherwise the PIN you choose becomes its two-step verification PIN. LeaseGuard uses it once and never stores it."
      submitLabel="Register number"
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
        <TextField control={form.control} name="pin" label="6-digit PIN" type="password" inputMode="numeric" autoComplete="off" maxLength={6} required />
        <p className="text-sm text-muted-foreground">
          Meta allows 10 registration attempts per 72 hours. After that it locks registration for 72 hours, and LeaseGuard tells you when you can
          try again.
        </p>
      </Form>
    </FormDialog>
  )
}

/** Company admins: verify again, register with a PIN, disconnect. The API decides; the page only asks. */
export function NumberActions({ number }: { number: WhatsAppPhoneNumber }) {
  const verify = useVerifyWhatsAppNumber()
  const disconnect = useDisconnectWhatsAppNumber()
  const [registering, setRegistering] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const locked = useRegistrationLocked(number)
  if (number.connectionStatus === 'disconnected') return null

  const registration = number.verificationSteps.find((s) => s.step === 'registration')
  const canRegister =
    number.connectionStatus !== 'connected' &&
    !locked &&
    // A run still checking may be past the registration step and would not use the PIN (the API refuses it then).
    !isNumberVerificationRunning(number) &&
    (registration?.status === 'action_needed' || registration?.status === 'failed')
  const label = number.displayNumber || `number id ${number.phoneNumberId}`

  const verifyAgain = async () => {
    try {
      toast.success((await verify.mutateAsync({ numberId: number.id })).message)
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : 'Verification could not be started. Try again.')
    }
  }
  const confirmDisconnect = async () => {
    try {
      toast.success((await disconnect.mutateAsync({ numberId: number.id })).message)
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : 'The number could not be disconnected. Try again.')
      throw error
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      {canRegister ? (
        <Button type="button" size="sm" onClick={() => setRegistering(true)}>
          <KeyRound aria-hidden="true" />
          Register number
        </Button>
      ) : null}
      <Button type="button" size="sm" variant="outline" onClick={() => void verifyAgain()} disabled={verify.isPending}>
        {verify.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
        Verify again
      </Button>
      <Button type="button" size="sm" variant="outline" onClick={() => setConfirming(true)}>
        <Unplug aria-hidden="true" />
        Disconnect
      </Button>
      <RegisterNumberDialog number={number} open={registering} onOpenChange={setRegistering} />
      <ConfirmationDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Disconnect ${label}?`}
        description="The number stops sending and receiving WhatsApp messages in LeaseGuard at once, and LeaseGuard deletes its stored access token. To use it again, connect it with Connect WhatsApp Business."
        confirmLabel="Disconnect"
        destructive
        onConfirm={confirmDisconnect}
        isPending={disconnect.isPending}
      />
    </div>
  )
}
