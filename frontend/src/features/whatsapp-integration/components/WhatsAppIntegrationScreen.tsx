import { Fragment, useId } from 'react'
import { AlertTriangle, Info, MessageCircle } from 'lucide-react'
import type { WhatsAppCapability } from '@leaseguard/api-client'

import { PageHeader } from '@/components/layout/PageHeader'
import { DateDisplay, EmptyState, ErrorState, LoadingState, NoActiveWorkspace, StatusBadge } from '@/components/shared'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useIsCompanyAdmin } from '@/features/account/useActiveRole'
import { isAwaitingWorkspace } from '@/lib/data/queries'
import { TONE_CLASSES } from '@/lib/labels'
import { cn } from '@/lib/utils'

import { useWhatsAppBusinessAccounts, useWhatsAppCapabilities } from '../api/queries'
import type { WhatsAppBusinessAccount, WhatsAppCapabilities, WhatsAppPhoneNumber } from '../api/source'
import { ConnectWhatsAppBusiness } from './ConnectWhatsAppBusiness'
import { MessageTemplatesCard } from './MessageTemplatesCard'
import { NumberActions, VerificationSteps } from './NumberVerification'

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
  return (
    <Badge variant="outline" className={cn('shrink-0', TONE_CLASSES[state === 'configured' ? 'success' : 'warning'])}>
      {SETUP_LABELS[state]}
    </Badge>
  )
}

/** The settings still missing, as "NAME (process)", e.g. "WHATSAPP_APP_SECRET (API)". */
function missingFor(capabilities: WhatsAppCapabilities, id: WhatsAppCapability): string[] {
  return capabilities.missing.filter((m) => m.capability === id).map((m) => `${m.setting} (${PROCESS_LABELS[m.process]})`)
}

/** Whether LeaseGuard itself is set up for Meta, and the approvals only Meta can give. */
function MetaSetup() {
  const titleId = useId()
  const query = useWhatsAppCapabilities()
  return (
    <Card role="region" aria-labelledby={titleId}>
      <CardHeader>
        <CardTitle id={titleId} className="text-base">
          Meta setup
        </CardTitle>
        <CardDescription>What this LeaseGuard installation is configured for. Nexus Solution manages these settings.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {query.isPending ? <LoadingState label="Loading the Meta setup…" rows={2} /> : null}
        {query.isError ? <ErrorState title="The Meta setup could not be loaded" error={query.error} onRetry={() => void query.refetch()} /> : null}
        {query.data ? <CapabilityList capabilities={query.data} /> : null}
        <p className="flex gap-2 text-sm text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            Connecting other businesses’ numbers also needs Meta’s approval of LeaseGuard’s app: Business Verification, App Review
            with Advanced Access for WhatsApp messaging and management, and each business’s payment method in WhatsApp Manager.
            These happen in Meta, so LeaseGuard cannot show them here.
          </span>
        </p>
      </CardContent>
    </Card>
  )
}

function CapabilityList({ capabilities }: { capabilities: WhatsAppCapabilities }) {
  const bannerId = useId()
  const incomplete = capabilities.missing.length > 0 || !capabilities.workerReporting
  return (
    <>
      {incomplete ? (
        <Alert aria-labelledby={bannerId} className="border-warning/40 bg-warning/10">
          <AlertTriangle aria-hidden="true" />
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
      <ul className="divide-y divide-border rounded-md border border-border">
        {CAPABILITIES.map(({ id, label, description }) => (
          <li key={id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">{label}</p>
              <p className="text-sm text-muted-foreground">{description}</p>
            </div>
            <SetupBadge state={setupState(capabilities, id)} />
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

function MetaDetail({ number }: { number: WhatsAppPhoneNumber }) {
  const facts = [
    number.qualityRating ? { label: 'Quality', value: number.qualityRating } : null,
    number.codeVerificationStatus ? { label: 'Verification', value: number.codeVerificationStatus } : null,
    number.nameStatus ? { label: 'Display name', value: number.nameStatus } : null,
    number.metaStatus ? { label: 'Meta status', value: number.metaStatus } : null,
    number.messagingLimitTier ? { label: 'Messaging limit', value: number.messagingLimitTier } : null,
  ].filter((fact) => fact !== null)
  if (facts.length === 0) return <span className="text-muted-foreground">Not reported yet</span>
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-2 text-xs">
      {facts.map((fact) => (
        <div key={fact.label} className="contents">
          <dt className="text-muted-foreground">{fact.label}</dt>
          <dd className="font-mono">{fact.value}</dd>
        </div>
      ))}
    </dl>
  )
}

function BusinessAccountCard({ account, isAdmin }: { account: WhatsAppBusinessAccount; isAdmin: boolean }) {
  const titleId = useId()
  const title = account.name ?? `WhatsApp Business Account ${account.businessAccountId}`
  return (
    <Card role="region" aria-labelledby={titleId}>
      <CardHeader>
        <CardTitle id={titleId} className="text-base">
          {title}
        </CardTitle>
        <CardDescription>Meta account id {account.businessAccountId}</CardDescription>
      </CardHeader>
      <CardContent>
        {account.numbers.length === 0 ? (
          <p className="text-sm text-muted-foreground">No numbers in this account yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden md:table-cell">Meta</TableHead>
                  <TableHead className="hidden sm:table-cell">Webhook</TableHead>
                  <TableHead className="hidden lg:table-cell">Last verified</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {account.numbers.map((number) => (
                  <Fragment key={number.id}>
                  <TableRow className="border-b-0">
                    <TableCell>
                      {/* A number from Embedded Signup has no display details until verification reads them from Meta. */}
                      <p className="font-medium tabular-nums">{number.displayNumber || `Number id ${number.phoneNumberId}`}</p>
                      <p className="text-xs text-muted-foreground">
                        {number.verifiedName ?? (number.displayName || 'Details appear after verification')}
                      </p>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={number.connectionStatus} />
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <MetaDetail number={number} />
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">{number.webhookConfigured ? 'Subscribed' : 'Not yet'}</TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <DateDisplay value={number.lastVerifiedAt} />
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell colSpan={5} className="space-y-3 whitespace-normal pt-0">
                      <VerificationSteps number={number} />
                      {isAdmin ? <NumberActions number={number} /> : null}
                    </TableCell>
                  </TableRow>
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
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
        icon={MessageCircle}
        title="No WhatsApp numbers yet"
        description="A number appears here once it is connected through Meta. It shows as connected only after LeaseGuard has verified it."
      />
    )
  }
  return (
    <div className="space-y-4">
      {query.data.map((account) => (
        <BusinessAccountCard key={account.id} account={account} isAdmin={isAdmin} />
      ))}
    </div>
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
    <section className="space-y-6">
      <PageHeader
        title="WhatsApp"
        description="This workspace’s WhatsApp Business Accounts and numbers, and what LeaseGuard needs from Meta."
        className="pb-0"
      />
      {isAdmin ? null : (
        <p className="flex gap-2 rounded-md border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          You can view the WhatsApp status. Only company admins can connect or change WhatsApp numbers.
        </p>
      )}
      <MetaSetup />
      {isAdmin ? <ConnectWhatsAppBusiness capabilities={capabilities.data} /> : null}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground">Business accounts and numbers</h2>
        <BusinessAccounts isAdmin={isAdmin} />
      </div>
      <MessageTemplatesCard />
    </section>
  )
}
