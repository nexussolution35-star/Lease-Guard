import { useId, useState } from 'react'
import { CheckCircle2, CircleAlert, CircleDashed, Clock, Lock, Power, Send } from 'lucide-react'
import { toast } from 'sonner'

import { AppLink, ConfirmationDialog, DateDisplay, ErrorState, LoadingState, ProgressIndicator } from '@/components/shared'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { isAwaitingWorkspace } from '@/lib/data/queries'
import { TONE_CLASSES, type Tone } from '@/lib/labels'
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
const STATE_ICONS = { done: CheckCircle2, action_needed: CircleAlert, waiting_on_meta: Clock, blocked: Lock } as const

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

function StateBadge({ state }: { state: State }) {
  return (
    <Badge variant="outline" className={cn('shrink-0', TONE_CLASSES[STATE_TONES[state]])}>
      {STATE_LABELS[state]}
    </Badge>
  )
}

function StepItem({ step, index, isAdmin, onSendTest }: { step: WhatsAppSetupStepStatus; index: number; isAdmin: boolean; onSendTest: () => void }) {
  const Icon = STATE_ICONS[step.state]
  const link = STEP_LINKS[step.step]
  return (
    <li className="flex gap-3 px-4 py-3">
      <Icon className={cn('mt-0.5 size-5 shrink-0', step.state === 'done' ? 'text-success' : 'text-muted-foreground')} aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium text-foreground">
            <span className="sr-only">Step {index + 1}: </span>
            {step.title}
          </p>
          {step.required ? null : <span className="text-xs text-muted-foreground">Recommended</span>}
          <StateBadge state={step.state} />
        </div>
        <p className="text-sm text-muted-foreground">{step.guidance}</p>
        {step.state !== 'done' && link ? (
          <AppLink to={link.to} className="text-sm font-medium text-primary underline-offset-4 hover:underline">
            {link.label}
          </AppLink>
        ) : null}
        {isAdmin && step.step === 'test_message' && step.state !== 'blocked' ? (
          <Button type="button" size="sm" variant={step.state === 'done' ? 'outline' : 'default'} onClick={onSendTest}>
            <Send aria-hidden="true" />
            {step.state === 'done' ? 'Send another test message' : 'Send test message'}
          </Button>
        ) : null}
      </div>
    </li>
  )
}

function LatestTestMessage({ message }: { message: WhatsAppTestMessage }) {
  return (
    <div className="rounded-md border border-border px-4 py-3 text-sm">
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
      <div className="flex flex-col gap-3 rounded-md border border-success/40 bg-success/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-foreground">
          WhatsApp is active{setup.activation.activatedAt ? <> since <DateDisplay value={setup.activation.activatedAt} /></> : null}.
          {setup.readyForActivation ? null : ' A required step is no longer verified: check the steps above.'}
        </p>
        {isAdmin ? (
          <>
            <Button type="button" size="sm" variant="outline" onClick={() => setConfirming(true)}>
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
    <div className="flex flex-col gap-3 rounded-md border border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-muted-foreground">
        {setup.readyForActivation
          ? 'Every required step is verified. WhatsApp can be activated.'
          : 'WhatsApp can be activated once every required step is verified.'}
      </p>
      {isAdmin ? (
        <Button type="button" size="sm" disabled={!setup.readyForActivation || change.isPending} onClick={() => void run(true).catch(() => undefined)}>
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
  const titleId = useId()
  const query = useWhatsAppSetup()
  const [testing, setTesting] = useState(false)
  if (isAwaitingWorkspace(query)) return null
  return (
    <Card role="region" aria-labelledby={titleId}>
      <CardHeader>
        <CardTitle id={titleId} className="flex items-center gap-2 text-base">
          <CircleDashed className="size-4" aria-hidden="true" />
          WhatsApp setup
        </CardTitle>
        <CardDescription>
          Each step is marked done only when LeaseGuard has verified it with Meta or in its own records. Recommended steps are not needed to
          activate WhatsApp.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {query.isPending ? <LoadingState label="Loading the WhatsApp setup…" rows={3} /> : null}
        {query.isError ? <ErrorState title="The WhatsApp setup could not be loaded" error={query.error} onRetry={() => void query.refetch()} /> : null}
        {query.data ? (
          <>
            <ProgressIndicator
              value={(query.data.completedSteps / query.data.totalSteps) * 100}
              label={`${query.data.completedSteps} of ${query.data.totalSteps} steps done`}
              tone={query.data.readyForActivation ? 'success' : 'primary'}
            />
            <ol className="divide-y divide-border rounded-md border border-border">
              {query.data.steps.map((step, index) => (
                <StepItem key={step.step} step={step} index={index} isAdmin={isAdmin} onSendTest={() => setTesting(true)} />
              ))}
            </ol>
            {isAdmin && query.data.latestTestMessage ? <LatestTestMessage message={query.data.latestTestMessage} /> : null}
            <Activation setup={query.data} isAdmin={isAdmin} />
          </>
        ) : null}
      </CardContent>
      {isAdmin ? <TestMessageDialog open={testing} onOpenChange={setTesting} /> : null}
    </Card>
  )
}
