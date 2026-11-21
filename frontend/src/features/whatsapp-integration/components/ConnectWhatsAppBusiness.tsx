import { useState } from 'react'
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2 } from 'lucide-react'

import { SectionHeader } from '@/components/shared'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

import { useCompleteWhatsAppSignup, usePrepareWhatsAppSignup, type PreparedWhatsAppSignup } from '../api/queries'
import type { WhatsAppCapabilities, WhatsAppOnboardingCompletion, WhatsAppOnboardingResult } from '../api/source'
import { runEmbeddedSignup } from '../embedded-signup/embeddedSignup'

type Step = { kind: 'idle' } | { kind: 'ready'; prepared: PreparedWhatsAppSignup } | { kind: 'in_popup' } | { kind: 'done'; result: WhatsAppOnboardingResult }

const RESULT_TITLES: Record<WhatsAppOnboardingResult['status'], string> = {
  exchanged: 'WhatsApp Business connected: pending verification',
  cancelled: 'Signup cancelled',
  failed: 'WhatsApp Business was not connected',
}

function ResultAlert({ result }: { result: WhatsAppOnboardingResult }) {
  const success = result.status === 'exchanged'
  const Icon = success ? CheckCircle2 : AlertTriangle
  return (
    <Alert role="status">
      <Icon aria-hidden="true" className={success ? 'text-success' : 'text-warning'} />
      <AlertTitle>{RESULT_TITLES[result.status]}</AlertTitle>
      <AlertDescription>
        <p>{result.message}</p>
        {result.phoneNumberIds.length > 0 ? (
          <p>
            Number {result.phoneNumberIds.join(', ')} now shows below as pending verification. It is not connected until LeaseGuard has
            verified it with Meta.
          </p>
        ) : null}
      </AlertDescription>
    </Alert>
  )
}

/**
 * Connect WhatsApp Business (company admins): Meta's Embedded Signup popup. The first click starts a
 * signup session and loads Facebook's SDK; the second opens Meta's window straight from the click, so
 * popup blockers allow it. The popup's result goes to the API at once (the code lives about 30 seconds).
 */
export function ConnectWhatsAppBusiness({ capabilities }: { capabilities: WhatsAppCapabilities | undefined }) {
  const [step, setStep] = useState<Step>({ kind: 'idle' })
  const prepare = usePrepareWhatsAppSignup()
  const complete = useCompleteWhatsAppSignup()
  const configured = capabilities?.embeddedSignupConfigured === true

  const startSignup = () => {
    complete.reset()
    prepare.mutate(undefined, { onSuccess: (prepared) => setStep({ kind: 'ready', prepared }) })
  }

  const openMeta = (prepared: PreparedWhatsAppSignup) => {
    setStep({ kind: 'in_popup' })
    // Called synchronously from the click: FB.login opens the popup inside runEmbeddedSignup.
    void runEmbeddedSignup(prepared.sdk, prepared.session).then((outcome) => {
      const completion: WhatsAppOnboardingCompletion = {
        state: prepared.session.state,
        event: outcome.event,
        ...(outcome.code ? { code: outcome.code } : {}),
        // Forwarded as Meta sent it; the API validates it.
        ...(outcome.sessionInfo ? { sessionInfo: outcome.sessionInfo as WhatsAppOnboardingCompletion['sessionInfo'] } : {}),
      }
      complete.mutate(
        { companyId: prepared.companyId, sessionId: prepared.session.sessionId, completion },
        { onSuccess: (result) => setStep({ kind: 'done', result }), onError: () => setStep({ kind: 'idle' }) },
      )
    })
  }

  const busy = prepare.isPending || step.kind === 'in_popup' || complete.isPending

  return (
    <section aria-label="Connect WhatsApp Business" className="space-y-4">
      <SectionHeader
        title="Connect WhatsApp Business"
        description="Link this workspace’s own WhatsApp Business number through Meta. The business keeps ownership of its account and pays Meta directly; LeaseGuard never handles payments."
      />
      {configured ? null : (
        <p className="flex max-w-prose gap-2 text-sm text-muted-foreground">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          <span>
            Requires Meta configuration: Embedded Signup is not set up for this LeaseGuard installation yet (see Meta setup above), so
            numbers cannot be connected.
          </span>
        </p>
      )}
      <div className="flex justify-end">
        <Button type="button" variant="outline" onClick={startSignup} disabled={!configured || busy}>
          {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
          {step.kind === 'in_popup' ? 'Waiting for Meta…' : complete.isPending ? 'Connecting…' : 'Connect WhatsApp Business'}
        </Button>
      </div>
      {prepare.isError ? (
        <Alert variant="destructive">
          <AlertTriangle aria-hidden="true" />
          <AlertTitle>The signup could not be started</AlertTitle>
          <AlertDescription>{prepare.error.message}</AlertDescription>
        </Alert>
      ) : null}
      {complete.isError ? (
        <Alert variant="destructive">
          <AlertTriangle aria-hidden="true" />
          <AlertTitle>The signup could not be completed</AlertTitle>
          <AlertDescription>{complete.error.message}</AlertDescription>
        </Alert>
      ) : null}
      {step.kind === 'done' ? <ResultAlert result={step.result} /> : null}

      <Dialog open={step.kind === 'ready'} onOpenChange={(open) => (open ? null : setStep({ kind: 'idle' }))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Continue in Meta’s window</DialogTitle>
            <DialogDescription>
              Meta’s signup opens in a new window. Sign in with Facebook, choose your business portfolio, WhatsApp Business Account and
              phone number, and click Finish on the last screen. Keep this page open until the window closes.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setStep({ kind: 'idle' })}>
              Cancel
            </Button>
            <Button type="button" onClick={() => (step.kind === 'ready' ? openMeta(step.prepared) : undefined)}>
              <ExternalLink aria-hidden="true" />
              Continue to Meta
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
