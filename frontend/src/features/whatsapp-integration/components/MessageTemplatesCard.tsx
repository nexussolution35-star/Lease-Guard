import { useId } from 'react'

import { DateDisplay, ErrorState, LoadingState } from '@/components/shared'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { isAwaitingWorkspace } from '@/lib/data/queries'
import { TONE_CLASSES, type Tone } from '@/lib/labels'
import { cn } from '@/lib/utils'

import { useWhatsAppMessageTemplates } from '../api/queries'

/** Meta's template statuses as the admin reads them. Anything else is shown as Meta reports it. */
const STATUS_TONES: Readonly<Record<string, Tone>> = {
  APPROVED: 'success',
  PENDING: 'info',
  IN_APPEAL: 'info',
  REJECTED: 'danger',
  DISABLED: 'danger',
  PAUSED: 'warning',
}

const sentence = (value: string) => value.charAt(0) + value.slice(1).toLowerCase().replaceAll('_', ' ')

/** The message templates Meta holds for the company's accounts, synced during number verification. */
export function MessageTemplatesCard() {
  const titleId = useId()
  const query = useWhatsAppMessageTemplates()
  if (isAwaitingWorkspace(query)) return null
  return (
    <Card role="region" aria-labelledby={titleId}>
      <CardHeader>
        <CardTitle id={titleId} className="text-base">
          Message templates
        </CardTitle>
        <CardDescription>
          The templates Meta holds for this workspace’s WhatsApp Business Accounts, as LeaseGuard last synced them. Meta reviews and approves
          each template; LeaseGuard sends only approved ones.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {query.isPending ? <LoadingState label="Loading message templates…" rows={2} /> : null}
        {query.isError ? <ErrorState title="Message templates could not be loaded" error={query.error} onRetry={() => void query.refetch()} /> : null}
        {query.data && query.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">No templates synced yet. They appear once a number has been verified.</p>
        ) : null}
        {query.data && query.data.length > 0 ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Template</TableHead>
                  <TableHead>Language</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden md:table-cell">Synced</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.map((template) => (
                  <TableRow key={template.id}>
                    <TableCell className="font-mono text-xs">{template.name}</TableCell>
                    <TableCell className="font-mono text-xs">{template.language}</TableCell>
                    <TableCell>{sentence(template.category)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cn(TONE_CLASSES[STATUS_TONES[template.status] ?? 'neutral'])}>
                        {sentence(template.status)}
                      </Badge>
                      {template.rejectedReason ? <p className="mt-1 text-xs text-muted-foreground">{sentence(template.rejectedReason)}</p> : null}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <DateDisplay value={template.syncedAt} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
