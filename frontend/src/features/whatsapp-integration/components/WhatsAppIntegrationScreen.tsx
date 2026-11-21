import { useId } from 'react'
import { AlertTriangle } from 'lucide-react'
import type { WhatsAppCapability } from '@leaseguard/api-client'

import { SETTINGS_SECTIONS } from '@/components/forms'
import { PageHeader } from '@/components/layout/PageHeader'
import {
  AppLink,
  DateDisplay,
  EmptyState,
  ErrorState,
  LoadingState,
  NoActiveWorkspace,
  SectionHeader,
  StatusBadge,
  StatusDot,
} from '@/components/shared'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { useIsCompanyAdmin } from '@/features/account/useActiveRole'
import { isAwaitingWorkspace } from '@/lib/data/queries'
import { cn } from '@/lib/utils'

import { useWhatsAppBusinessAccounts, useWhatsAppCapabilities } from '../api/queries'
import type { WhatsAppBusinessAccount, WhatsAppCapabilities, WhatsAppPhoneNumber } from '../api/source'
import { ConnectWhatsAppBusiness } from './ConnectWhatsAppBusiness'
import { MessageTemplatesCard } from './MessageTemplatesCard'
import { NumberActions, VerificationSteps } from './NumberVerification'
import { WhatsAppSetupProgress } from './WhatsAppSetupProgress'

const CAPABILITIES: readonly { id: WhatsAppCapability; label: string; description: string }[] = [
  {
    id: 'embedded_signup',
    label: 'Connect numbers with Meta',
    description: 'Meta Embedded Signup, which links a business’s WhatsApp number to LeaseGuard.',
  },
  { id: 'webhook', label: 'Receive messages and delivery updates', description: 'The webhook Meta calls for inbound messages and statuses.' },
  { id: 'agent_runtime', label: 'AI agent replies', description: 'The AI agent that answers contacts. Tenants are never answered automatically.' },
]

const PROCESS_LABELS = { api: 'API', worker: 'worker' } as const

function configuredFlag(capabilities: WhatsAppCapabilities, id: WhatsAppCapability): boolean {
  switch (id) {
    case 'embedded_signup':
      return capabilities.embeddedSignupConfigured
    case 'webhook':
      return capabilities.webhookConfigured
    case 'agent_runtime':
      return capabilities.agentRuntimeConfigured
  }
}

type SetupState = 'configured' | 'requires_configuration' | 'worker_not_reporting'

const SETUP_LABELS: Record<SetupState, string> = {
  configured: 'Configured',
  requires_configuration: 'Requires configuration',
  worker_not_reporting: 'Worker not reporting',
}

/** The agent runtime is known only from the worker's own report: without one it is unknown, not "missing a key". */
function setupState(capabilities: WhatsAppCapabilities, id: WhatsAppCapability): SetupState {
  if (id === 'agent_runtime' && !capabilities.workerReporting) return 'worker_not_reporting'
  return configuredFlag(capabilities, id) ? 'configured' : 'requires_configuration'
}

function SetupBadge({ state }: { state: SetupState }) {
  return <StatusDot tone={state === 'configured' ? 'success' : 'warning'}>{SETUP_LABELS[state]}</StatusDot>
}

/** The settings still missing, as "NAME (process)", e.g. "WHATSAPP_APP_SECRET (API)". */
function missingFor(capabilities: WhatsAppCapabilities, id: WhatsAppCapability): string[] {
  return capabilities.missing.filter((m) => m.capability === id).map((m) => `${m.setting} (${PROCESS_LABELS[m.process]})`)
}

/** Whether LeaseGuard itself is set up for Meta, and the approvals only Meta can give. */
function MetaSetup() {
  const query = useWhatsAppCapabilities()
  return (
    <section aria-label="Meta setup" className="space-y-4">
      <SectionHeader title="Meta setup" description="What this LeaseGuard installation is configured for. Nexus Solution manages these settings." />
      {query.isPending ? <LoadingState label="Loading the Meta setup…" rows={2} /> : null}
      {query.isError ? <ErrorState title="The Meta setup could not be loaded" error={query.error} onRetry={() => void query.refetch()} /> : null}
      {query.data ? <CapabilityList capabilities={query.data} /> : null}
      <p className="max-w-prose text-sm text-muted-foreground">
        Connecting other businesses’ numbers also needs Meta’s approval of LeaseGuard’s app: Business Verification, App Review with
        Advanced Access for WhatsApp messaging and management, and each business’s payment method in WhatsApp Manager. These happen in
        Meta, so LeaseGuard cannot show them here.
      </p>
    </section>
  )
}

function CapabilityList({ capabilities }: { capabilities: WhatsAppCapabilities }) {
  const bannerId = useId()
  const incomplete = capabilities.missing.length > 0 || !capabilities.workerReporting
  return (
    <>
      {incomplete ? (
        <Alert aria-labelledby={bannerId}>
          <AlertTriangle aria-hidden="true" className="text-warning" />
          <AlertTitle id={bannerId}>Requires Meta configuration or approval</AlertTitle>
          <AlertDescription>
            <p>These features are not available until the missing settings are added. Missing settings, by the process that reads them:</p>
            <ul className="list-disc pl-5">
              {CAPABILITIES.filter(({ id }) => missingFor(capabilities, id).length > 0).map(({ id, label }) => (
                <li key={id}>
                  {label}: <span className="font-mono text-xs">{missingFor(capabilities, id).join(', ')}</span>
                </li>
              ))}
              {capabilities.workerReporting ? null : (
                <li>
                  AI agent replies: the worker has not reported in the last five minutes, so LeaseGuard cannot tell whether it is
                  configured. Check that the worker is running and can reach Redis.
                </li>
              )}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
      <ul className="divide-y divide-border border-y border-border">
        {CAPABILITIES.map(({ id, label, description }) => (
          <li key={id} className="grid gap-x-3 gap-y-1 py-3 sm:grid-cols-[minmax(0,1fr)_9.5rem] sm:items-start">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">{label}</p>
              <p className="text-sm text-muted-foreground">{description}</p>
            </div>
            <div className="sm:pt-px">
              <SetupBadge state={setupState(capabilities, id)} />
            </div>
          </li>
        ))}
      </ul>
      {capabilities.workerReportedAt ? (
        <p className="text-sm text-muted-foreground">
          The worker last reported <DateDisplay value={capabilities.workerReportedAt} style="datetime" />.
        </p>
      ) : null}
    </>
  )
}

/** What Meta and LeaseGuard report about a number, on one line. */
function NumberFacts({ number }: { number: WhatsAppPhoneNumber }) {
  const meta = [
    number.qualityRating ? { label: 'Quality', value: number.qualityRating } : null,
    number.codeVerificationStatus ? { label: 'Verification', value: number.codeVerificationStatus } : null,
    number.nameStatus ? { label: 'Display name', value: number.nameStatus } : null,
    number.metaStatus ? { label: 'Meta status', value: number.metaStatus } : null,
    number.messagingLimitTier ? { label: 'Messaging limit', value: number.messagingLimitTier } : null,
  ].filter((fact) => fact !== null)
  return (
    <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs tabular-nums">
      {meta.length === 0 ? (
        <div className="flex gap-1.5">
          <dt className="text-muted-foreground">Meta</dt>
          <dd>Not reported yet</dd>
        </div>
      ) : (
        meta.map((fact) => (
          <div key={fact.label} className="flex gap-1.5">
            <dt className="text-muted-foreground">{fact.label}</dt>
            <dd className="font-mono">{fact.value}</dd>
          </div>
        ))
      )}
      <div className="flex gap-1.5">
        <dt className="text-muted-foreground">Webhook</dt>
        <dd>{number.webhookConfigured ? 'Subscribed' : 'Not yet'}</dd>
      </div>
      <div className="flex gap-1.5">
        <dt className="text-muted-foreground">Last verified</dt>
        <dd>
          <DateDisplay value={number.lastVerifiedAt} />
        </dd>
      </div>
    </dl>
  )
}

function BusinessAccountCard({ account, isAdmin }: { account: WhatsAppBusinessAccount; isAdmin: boolean }) {
  const titleId = useId()
  const title = account.name ?? `WhatsApp Business Account ${account.businessAccountId}`
  return (
    <section aria-labelledby={titleId}>
      <h3 id={titleId} className="text-sm font-medium text-balance text-foreground">
        {title}
      </h3>
      <p className="text-xs text-muted-foreground tabular-nums">Meta account id {account.businessAccountId}</p>
      {account.numbers.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No numbers in this account yet.</p>
      ) : (
        <ul aria-label="Numbers" className="mt-3 divide-y divide-border border-y border-border">
          {account.numbers.map((number) => (
            <li key={number.id} className="space-y-3 py-4">
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    {/* A number from Embedded Signup has no display details until verification reads them from Meta. */}
                    <span className="text-sm font-medium text-foreground tabular-nums">{number.displayNumber || `Number id ${number.phoneNumberId}`}</span>
                    <StatusBadge status={number.connectionStatus} />
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {number.verifiedName ?? (number.displayName || 'Details appear after verification')}
                  </p>
                </div>
                {isAdmin ? <NumberActions number={number} /> : null}
              </div>
              <NumberFacts number={number} />
              <VerificationSteps number={number} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function BusinessAccounts({ isAdmin }: { isAdmin: boolean }) {
  const query = useWhatsAppBusinessAccounts()
  if (isAwaitingWorkspace(query)) return <NoActiveWorkspace />
  if (query.isPending) return <LoadingState label="Loading WhatsApp numbers…" />
  if (query.isError) return <ErrorState title="WhatsApp numbers could not be loaded" error={query.error} onRetry={() => void query.refetch()} />
  if (query.data.length === 0) {
    return (
      <EmptyState
        title="No WhatsApp numbers yet"
        description="A number appears here once it is connected through Meta. It shows as connected only after LeaseGuard has verified it."
        className="py-0"
      />
    )
  }
  return (
    <div className="space-y-6">
      {query.data.map((account) => (
        <BusinessAccountCard key={account.id} account={account} isAdmin={isAdmin} />
      ))}
    </div>
  )
}

/** Where the company's AI agent and knowledge base are set up (ticket 09). */
function AgentLinkCard({ isAdmin }: { isAdmin: boolean }) {
  return (
    <section aria-label="AI agent and knowledge base">
      <SectionHeader
        title="AI agent and knowledge base"
        description="The agent answers contacts' common questions from your approved information. Tenants are never answered automatically."
        actions={
          <AppLink to="/settings/integrations/whatsapp/agent" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
            {isAdmin ? 'Set up the AI agent' : 'View the AI agent settings'}
          </AppLink>
        }
      />
    </section>
  )
}

/**
 * Settings → Integrations → WhatsApp: the active company's WhatsApp Business Accounts and numbers with the
 * status LeaseGuard verified, what LeaseGuard still needs from Meta, and (company admins) Connect WhatsApp
 * Business through Meta Embedded Signup. Statuses come from the API only, so the page never shows a number
 * as connected that LeaseGuard has not verified.
 */
export function WhatsAppIntegrationScreen() {
  const isAdmin = useIsCompanyAdmin()
  const capabilities = useWhatsAppCapabilities()
  return (
    <section>
      <PageHeader title="WhatsApp" description="This workspace’s WhatsApp Business Accounts and numbers, and what LeaseGuard needs from Meta." />
      {isAdmin ? null : (
        <p className="mb-6 text-sm text-muted-foreground">
          You can view the WhatsApp status. Only company admins can connect or change WhatsApp numbers.
        </p>
      )}
      {/* One hairline between sections; a section that renders nothing leaves no line. */}
      <div className={cn('max-w-3xl', SETTINGS_SECTIONS)}>
        <WhatsAppSetupProgress isAdmin={isAdmin} />
        <MetaSetup />
        {isAdmin ? <ConnectWhatsAppBusiness capabilities={capabilities.data} /> : null}
        <section className="space-y-4">
          <SectionHeader title="Business accounts and numbers" />
          <BusinessAccounts isAdmin={isAdmin} />
        </section>
        <AgentLinkCard isAdmin={isAdmin} />
        <MessageTemplatesCard />
      </div>
    </section>
  )
}
