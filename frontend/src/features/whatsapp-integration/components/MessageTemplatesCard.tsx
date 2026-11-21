import { DateDisplay, ErrorState, LoadingState, SectionHeader, StatusDot } from '@/components/shared'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { isAwaitingWorkspace } from '@/lib/data/queries'
import type { Tone } from '@/lib/labels'

import { useWhatsAppMessageTemplates } from '../api/queries'

/** Meta's template statuses as the admin reads them. Anything else is shown as Meta reports it. */
const STATUS_TONES: Readonly<Record<string, Tone>> = {
  APPROVED: 'success',
  PENDING: 'info',
  IN_APPEAL: 'info',
  REJECTED: 'danger',
  DISABLED: 'danger',
  PAUSED: 'warning',
  FLAGGED: 'warning',
}

const sentence = (value: string) => value.charAt(0) + value.slice(1).toLowerCase().replaceAll('_', ' ')

/** The message templates Meta holds for the company's accounts, synced during number verification. */
export function MessageTemplatesCard() {
  const query = useWhatsAppMessageTemplates()
  if (isAwaitingWorkspace(query)) return null
  return (
    <section aria-label="Message templates" className="space-y-4">
      <SectionHeader
        title="Message templates"
        description="The templates Meta holds for this workspace’s WhatsApp Business Accounts, synced during verification and kept up to date when Meta changes a status. Meta reviews and approves each template; LeaseGuard sends only approved ones."
      />
      {query.isPending ? <LoadingState label="Loading message templates…" rows={2} /> : null}
      {query.isError ? <ErrorState title="Message templates could not be loaded" error={query.error} onRetry={() => void query.refetch()} /> : null}
      {query.data && query.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">No templates synced yet. They appear once a number has been verified.</p>
      ) : null}
      {query.data && query.data.length > 0 ? (
        <div className="border-y border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Template</TableHead>
                <TableHead>Language</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden md:table-cell">Last updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data.map((template) => {
                const tone = STATUS_TONES[template.status] ?? 'neutral'
                return (
                  <TableRow key={template.id}>
                    <TableCell className="font-mono text-xs">{template.name}</TableCell>
                    <TableCell className="font-mono text-xs">{template.language}</TableCell>
                    <TableCell>{sentence(template.category)}</TableCell>
                    <TableCell>
                      <StatusDot tone={tone}>{sentence(template.status)}</StatusDot>
                      {template.rejectedReason ? <p className="mt-1 text-xs text-muted-foreground">{sentence(template.rejectedReason)}</p> : null}
                    </TableCell>
                    <TableCell className="hidden tabular-nums md:table-cell">
                      <DateDisplay value={template.statusUpdatedAt ?? template.syncedAt} />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </section>
  )
}
