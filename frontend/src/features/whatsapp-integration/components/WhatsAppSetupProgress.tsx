import { useState } from 'react'
import { Power, Send } from 'lucide-react'
import { toast } from 'sonner'

import { AppLink, ConfirmationDialog, DateDisplay, ErrorState, LoadingState, ProgressIndicator, SectionHeader, SignOff, StatusDot } from '@/components/shared'
import { Button } from '@/components/ui/button'
import { isAwaitingWorkspace } from '@/lib/data/queries'
import type { Tone } from '@/lib/labels'
import { cn } from '@/lib/utils'

import { useSetWhatsAppActivation, useWhatsAppSetup } from '../api/queries'
import type { WhatsAppSetup, WhatsAppSetupStepStatus, WhatsAppTestMessage } from '../api/source'
import { TestMessageDialog } from './TestMessageDialog'

type State = WhatsAppSetupStepStatus['state']

const STATE_LABELS: Record<State, string> = {
  done: 'Done',
  action_needed: 'Action needed',
  waiting_on_meta: 'Waiting on Meta',
  blocked: 'Blocked',
}
const STATE_TONES: Record<State, Tone> = { done: 'success', action_needed: 'warning', waiting_on_meta: 'info', blocked: 'neutral' }

/** Where a step is done, when it is not on this page. */
const STEP_LINKS: Partial<Record<WhatsAppSetupStepStatus['step'], { to: string; label: string }>> = {
  business_profile: { to: '/settings/company', label: 'Open the company profile' },
  ai_agent: { to: '/settings/integrations/whatsapp/agent', label: 'Configure the AI agent' },
  knowledge_base: { to: '/settings/integrations/whatsapp/agent', label: 'Open the knowledge base' },
}

const TEST_STATUS_LABELS: Record<WhatsAppTestMessage['status'], string> = {
  queued: 'Queued',
  sending: 'Sending',
  sent: 'Sent, waiting for Meta to report delivery',
  delivered: 'Delivered',
  read: 'Read',
  failed: 'Failed',
}

/** A step's status mark. "Action needed" waits on a company admin, so it carries the open sign-off ring. */
function StepStatus({ state }: { state: State }) {
  if (state === 'action_needed') return <SignOff pendingLabel={STATE_LABELS[state]} />
  return <StatusDot tone={STATE_TONES[state]}>{STATE_LABELS[state]}</StatusDot>
}

function StepItem({
  step,
  index,
  isAdmin,
  onSendTest,
  latestTestMessage,
}: {
  step: WhatsAppSetupStepStatus
  index: number
  isAdmin: boolean
  onSendTest: () => void
  latestTestMessage: WhatsAppTestMessage | undefined
}) {
  const link = STEP_LINKS[step.step]
  // A step still to do reads as foreground; done and blocked steps stay quiet.
  const open = step.state === 'action_needed' || step.state === 'waiting_on_meta'
  return (
    <li className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 py-3 sm:grid-cols-[1.5rem_minmax(0,1fr)_9.5rem]">
      <span aria-hidden="true" className="pt-px text-sm text-muted-foreground tabular-nums">
        {index + 1}
      </span>
      <div className="min-w-0 space-y-1">
        <p className="flex flex-wrap items-baseline gap-x-2 text-sm text-balance">
          <span className={cn('font-medium', open ? 'text-foreground' : 'text-foreground/80')}>
            <span className="sr-only">Step {index + 1}: </span>
            {step.title}
          </span>
          {step.required ? null : <span className="text-xs text-muted-foreground">Recommended</span>}
        </p>
        <p className="max-w-prose text-sm text-muted-foreground">{step.guidance}</p>
        {step.state !== 'done' && link ? (
          <AppLink to={link.to} className="inline-block text-sm font-medium text-primary underline-offset-4 hover:underline">
            {link.label}
          </AppLink>
        ) : null}
        {step.step === 'test_message' && latestTestMessage ? <LatestTestMessage message={latestTestMessage} /> : null}
        {isAdmin && step.step === 'test_message' && step.state !== 'blocked' ? (
          <div className="flex justify-end">
            <Button type="button" size="sm" variant="outline" className="mt-1" onClick={onSendTest}>
              <Send aria-hidden="true" />
              {step.state === 'done' ? 'Send another test message' : 'Send test message'}
            </Button>
          </div>
        ) : null}
      </div>
      <div className="col-start-2 sm:col-start-3 sm:row-start-1 sm:justify-self-start">
        <StepStatus state={step.state} />
      </div>
    </li>
  )
}

function LatestTestMessage({ message }: { message: WhatsAppTestMessage }) {
  return (
    <div className="text-sm">
      <p className="font-medium text-foreground">
        Latest test message: {TEST_STATUS_LABELS[message.status]}
      </p>
      <p className="text-muted-foreground">
        Template <span className="font-mono text-xs">{message.templateName}</span> to <span className="tabular-nums">{message.toNumber}</span>,{' '}
        <DateDisplay value={message.createdAt} style="datetime" />
      </p>
      {message.failureReason ? <p className="text-destructive">{message.failureReason}</p> : null}
    </div>
  )
}

function Activation({ setup, isAdmin }: { setup: WhatsAppSetup; isAdmin: boolean }) {
  const change = useSetWhatsAppActivation()
  const [confirming, setConfirming] = useState(false)
  const run = async (active: boolean) => {
    try {
      await change.mutateAsync({ active })
      toast.success(active ? 'WhatsApp is active for this workspace.' : 'WhatsApp is no longer marked active.')
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : 'The activation could not be changed. Try again.')
      throw error
    }
  }
  if (setup.activation.active) {
    return (
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex gap-2 text-sm text-foreground">
          <span aria-hidden="true" className="mt-[7px] size-1.5 shrink-0 rounded-full bg-success" />
          <span>
            WhatsApp is active{setup.activation.activatedAt ? <> since <DateDisplay value={setup.activation.activatedAt} /></> : null}.
            {setup.readyForActivation ? null : ' A required step is no longer verified: check the steps above.'}
          </span>
        </p>
        {isAdmin ? (
          <>
            <Button type="button" size="sm" variant="outline" className="self-end sm:self-auto" onClick={() => setConfirming(true)}>
              <Power aria-hidden="true" />
              Deactivate
            </Button>
            <ConfirmationDialog
              open={confirming}
              onOpenChange={setConfirming}
              title="Deactivate WhatsApp?"
              description="The workspace is marked as not active for WhatsApp. Numbers stay connected; you can activate again once every required step is verified."
              confirmLabel="Deactivate"
              onConfirm={() => run(false)}
              isPending={change.isPending}
            />
          </>
        ) : null}
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-muted-foreground">
        {setup.readyForActivation
          ? 'Every required step is verified. WhatsApp can be activated.'
          : 'WhatsApp can be activated once every required step is verified.'}
      </p>
      {isAdmin ? (
        <Button type="button" size="sm" className="self-end sm:self-auto" disabled={!setup.readyForActivation || change.isPending} onClick={() => void run(true).catch(() => undefined)}>
          <Power aria-hidden="true" />
          Activate WhatsApp
        </Button>
      ) : null}
    </div>
  )
}

/**
 * The company's WhatsApp setup: ten steps, each done only when the API reports it verified, with what to do next; the
 * test message (company admins) and the activation, which the API refuses until every required step is verified.
 */
export function WhatsAppSetupProgress({ isAdmin }: { isAdmin: boolean }) {
  const query = useWhatsAppSetup()
  const [testing, setTesting] = useState(false)
  if (isAwaitingWorkspace(query)) return null
  return (
    <section aria-label="WhatsApp setup" className="space-y-4">
      <SectionHeader
        title="WhatsApp setup"
        description="Each step is marked done only when LeaseGuard has verified it with Meta or in its own records. Recommended steps are not needed to activate WhatsApp."
      />
      {query.isPending ? <LoadingState label="Loading the WhatsApp setup…" rows={3} /> : null}
      {query.isError ? <ErrorState title="The WhatsApp setup could not be loaded" error={query.error} onRetry={() => void query.refetch()} /> : null}
      {query.data ? (
        <>
          <ProgressIndicator
            value={(query.data.completedSteps / query.data.totalSteps) * 100}
            label={`${query.data.completedSteps} of ${query.data.totalSteps} steps done`}
            showValue={false}
            tone={query.data.readyForActivation ? 'success' : 'neutral'}
          />
          <ol className="divide-y divide-border border-y border-border">
            {query.data.steps.map((step, index) => (
              <StepItem
                key={step.step}
                step={step}
                index={index}
                isAdmin={isAdmin}
                onSendTest={() => setTesting(true)}
                latestTestMessage={isAdmin ? query.data.latestTestMessage : undefined}
              />
            ))}
          </ol>
          <div className="pt-1">
            <Activation setup={query.data} isAdmin={isAdmin} />
          </div>
        </>
      ) : null}
      {isAdmin ? <TestMessageDialog open={testing} onOpenChange={setTesting} /> : null}
    </section>
  )
}
