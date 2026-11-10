import { useId } from 'react'
import { ArrowLeft, Info, ShieldCheck } from 'lucide-react'

import { PageHeader } from '@/components/layout/PageHeader'
import { AppLink, ErrorState, LoadingState, NoActiveWorkspace } from '@/components/shared'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useIsCompanyAdmin } from '@/features/account/useActiveRole'
import { useMemberList } from '@/features/users/api/queries'
import { isAwaitingWorkspace } from '@/lib/data/queries'
import { MAX_LIST_PAGE_SIZE } from '@/lib/data/listParams'

import { useAgentConfig } from '../api/queries'
import { AgentConfigForm } from './AgentConfigForm'
import { KnowledgeBase } from './KnowledgeBase'

/** What the agent never does, whatever the settings say (enforced by LeaseGuard, not by the settings). */
const SAFEGUARDS: readonly string[] = [
  'Tenants are never answered automatically. When a tenant writes, staff see a suggested reply and the conversation is handed to a person; tenants only receive approved statement and payment messages.',
  'The agent only uses this company’s approved FAQs, knowledge entries and documents. Drafts and other companies’ information never reach it.',
  'Complaints, payments, payment arrangements, disputes, lease expiry, renewals and anything it is unsure about go to a person, and your handover contacts are told.',
  'It never shares banking details and never takes or arranges payments.',
  'It only answers contacts inside WhatsApp’s 24-hour window, within your operating hours, and only when you turn auto-reply on.',
]

function Safeguards() {
  const titleId = useId()
  return (
    <Card role="region" aria-labelledby={titleId} className="border-primary/30 bg-primary/5">
      <CardHeader>
        <CardTitle id={titleId} className="flex items-center gap-2 text-base">
          <ShieldCheck className="size-4 text-primary" aria-hidden="true" />
          Safeguards that always apply
        </CardTitle>
        <CardDescription>LeaseGuard enforces these for every company. Your settings cannot turn them off.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
          {SAFEGUARDS.map((safeguard) => (
            <li key={safeguard}>{safeguard}</li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

function AgentSettings({ canEdit }: { canEdit: boolean }) {
  const config = useAgentConfig()
  const members = useMemberList({ page: 1, pageSize: MAX_LIST_PAGE_SIZE })
  if (isAwaitingWorkspace(config)) return <NoActiveWorkspace />
  if (config.isPending) return <LoadingState label="Loading the AI agent settings…" />
  if (config.isError) return <ErrorState title="The AI agent settings could not be loaded" error={config.error} onRetry={() => void config.refetch()} />
  return <AgentConfigForm key={`${config.data.companyId}:${config.data.updatedAt ?? 'new'}`} config={config.data} members={members.data?.items ?? []} canEdit={canEdit} />
}

/**
 * Settings → Integrations → WhatsApp → AI agent: the company's AI agent configuration and knowledge base. Company
 * admins change them; other members see them read-only. The safeguards are explained at the top: tenants are never
 * answered automatically.
 */
export function AgentSettingsScreen() {
  const isAdmin = useIsCompanyAdmin()
  const settingsId = useId()
  const knowledgeId = useId()
  return (
    <section className="space-y-6">
      <AppLink to="/settings/integrations/whatsapp" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden="true" />
        WhatsApp
      </AppLink>
      <PageHeader
        title="AI agent"
        description="How this company’s WhatsApp agent answers contacts, and the approved information it may use."
        className="pb-0"
      />
      {isAdmin ? null : (
        <p className="flex gap-2 rounded-md border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          You can view the AI agent settings and knowledge base. Only company admins can change or approve them.
        </p>
      )}
      <Safeguards />
      <Card role="region" aria-labelledby={settingsId}>
        <CardHeader>
          <CardTitle id={settingsId} className="text-base">
            Agent settings
          </CardTitle>
        </CardHeader>
        <CardContent>
          <AgentSettings canEdit={isAdmin} />
        </CardContent>
      </Card>
      <Card role="region" aria-labelledby={knowledgeId}>
        <CardHeader>
          <CardTitle id={knowledgeId} className="text-base">
            Knowledge base
          </CardTitle>
          <CardDescription>Everything starts as a draft. The agent only uses items a company admin has approved.</CardDescription>
        </CardHeader>
        <CardContent>
          <KnowledgeBase canEdit={isAdmin} />
        </CardContent>
      </Card>
    </section>
  )
}
