import { SETTINGS_SECTIONS } from '@/components/forms'
import { PageHeader } from '@/components/layout/PageHeader'
import { ErrorState, LoadingState, NoActiveWorkspace, SectionHeader } from '@/components/shared'
import { useIsCompanyAdmin } from '@/features/account/useActiveRole'
import { useMemberList } from '@/features/users/api/queries'
import { isAwaitingWorkspace } from '@/lib/data/queries'
import { MAX_LIST_PAGE_SIZE } from '@/lib/data/listParams'
import { cn } from '@/lib/utils'

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
  return (
    <section aria-label="Safeguards that always apply" className="space-y-3">
      <SectionHeader title="Safeguards that always apply" description="LeaseGuard enforces these for every company. Your settings cannot turn them off." />
      <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
        {SAFEGUARDS.map((safeguard) => (
          <li key={safeguard}>{safeguard}</li>
        ))}
      </ul>
    </section>
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
  return (
    <section>
      <PageHeader title="AI agent" description="How this company’s WhatsApp agent answers contacts, and the approved information it may use." />
      {isAdmin ? null : (
        <p className="mb-6 text-sm text-muted-foreground">
          You can view the AI agent settings and knowledge base. Only company admins can change or approve them.
        </p>
      )}
      <div className={cn('max-w-3xl', SETTINGS_SECTIONS)}>
        <Safeguards />
        <section aria-label="Agent settings" className="space-y-4">
          <SectionHeader title="Agent settings" />
          <AgentSettings canEdit={isAdmin} />
        </section>
        <section aria-label="Knowledge base" className="space-y-4">
          <SectionHeader title="Knowledge base" description="Everything starts as a draft. The agent only uses items a company admin has approved." />
          <KnowledgeBase canEdit={isAdmin} />
        </section>
      </div>
    </section>
  )
}
