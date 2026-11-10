import { Info, MessageCircle } from 'lucide-react'
import { useId } from 'react'
import type { Communication, EntityId } from '@leaseguard/domain'

import { PageHeader } from '@/components/layout/PageHeader'
import { AppLink, DataTablePagination, DateDisplay, EmptyState, ErrorState, LoadingState, NoActiveWorkspace, StatusBadge } from '@/components/shared'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { isAwaitingWorkspace } from '@/lib/data/queries'
import { cn } from '@/lib/utils'

import { useConversation, useConversationList } from '../api/queries'
import type { WhatsAppConversation, WhatsAppConversationSummary } from '../api/source'

export interface InboxParams {
  page: number
  pageSize: number
  /** The open conversation. */
  conversation?: EntityId
}

export interface ConversationsInboxProps {
  params: InboxParams
  /** Called with the complete next state (the route keeps it in the URL). */
  onParamsChange: (next: InboxParams) => void
}

/** How a contact is named: profile name, else number; Meta may share neither name nor number. */
function contactName(contact: WhatsAppConversationSummary['contact']): string {
  return contact.profileName ?? contact.phoneNumber ?? 'WhatsApp user'
}

/** When a message was sent: the sender's time for inbound messages, else when it went out or was created. */
function messageTime(message: Communication): string {
  return message.receivedAt ?? message.sentAt ?? message.createdAt
}

/**
 * The WhatsApp conversations inbox of the active workspace (read-only in this version): conversations, most recent
 * first, and the open conversation's messages. Messages arrive through Meta's webhook, routed to this workspace by
 * the number they were sent to; the inbox refreshes itself.
 */
export function ConversationsInbox({ params, onParamsChange }: ConversationsInboxProps) {
  const list = useConversationList({ page: params.page, pageSize: params.pageSize })
  const header = (
    <PageHeader title="Conversations" description="WhatsApp messages people sent to this workspace's business numbers." />
  )

  if (isAwaitingWorkspace(list)) {
    return (
      <section>
        {header}
        <NoActiveWorkspace />
      </section>
    )
  }

  const select = (conversation: EntityId | undefined) => {
    const { conversation: _previous, ...rest } = params
    onParamsChange(conversation ? { ...rest, conversation } : rest)
  }

  return (
    <section className="space-y-4">
      {header}
      <Alert>
        <Info aria-hidden="true" />
        <AlertDescription>
          The inbox is read-only for now: replying to contacts and taking over conversations come in a later release. Tenants are never
          answered automatically.
        </AlertDescription>
      </Alert>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <ConversationList
          query={list}
          selected={params.conversation}
          onSelect={select}
          page={params.page}
          pageSize={params.pageSize}
          onPageChange={(page) => onParamsChange({ ...params, page })}
        />
        <ConversationThread id={params.conversation} onClose={() => select(undefined)} />
      </div>
    </section>
  )
}

function ConversationList({
  query,
  selected,
  onSelect,
  page,
  pageSize,
  onPageChange,
}: {
  query: ReturnType<typeof useConversationList>
  selected: EntityId | undefined
  onSelect: (id: EntityId) => void
  page: number
  pageSize: number
  onPageChange: (page: number) => void
}) {
  const headingId = useId()
  return (
    <Card aria-labelledby={headingId} role="region">
      <CardHeader>
        <CardTitle id={headingId}>Inbox</CardTitle>
        {query.data ? (
          <CardDescription>
            {query.data.total === 1 ? '1 conversation' : `${query.data.total} conversations`}
          </CardDescription>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">
        {query.isPending ? (
          <LoadingState label="Loading conversations…" rows={4} />
        ) : query.isError ? (
          <ErrorState title="Could not load conversations" error={query.error} onRetry={() => void query.refetch()} />
        ) : query.data.items.length === 0 ? (
          <EmptyState
            icon={MessageCircle}
            title="No conversations yet"
            description="When someone messages one of this workspace's connected WhatsApp numbers, the conversation appears here."
          />
        ) : (
          <>
            <ul className="divide-y divide-border rounded-md border border-border" aria-label="Conversations">
              {query.data.items.map((conversation) => {
                const isSelected = conversation.id === selected
                return (
                  <li key={conversation.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(conversation.id)}
                      aria-current={isSelected ? 'true' : undefined}
                      className={cn(
                        'flex w-full flex-col gap-1 px-3 py-2 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring',
                        isSelected && 'bg-accent',
                      )}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium text-foreground">{contactName(conversation.contact)}</span>
                        <DateDisplay value={conversation.lastMessageAt} style="datetime" className="shrink-0 text-xs text-muted-foreground" />
                      </span>
                      {conversation.contact.tenantName ? (
                        <span>
                          <Badge variant="outline">Tenant · {conversation.contact.tenantName}</Badge>
                        </span>
                      ) : null}
                      {conversation.lastMessagePreview ? (
                        <span className="line-clamp-2 text-sm text-muted-foreground">{conversation.lastMessagePreview}</span>
                      ) : null}
                      <span className="text-xs text-muted-foreground">To {conversation.companyNumber}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
            {query.data.total > pageSize ? (
              <DataTablePagination page={page} pageSize={pageSize} total={query.data.total} onPageChange={onPageChange} />
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  )
}

function ConversationThread({ id, onClose }: { id: EntityId | undefined; onClose: () => void }) {
  const query = useConversation(id)
  if (id === undefined) {
    return (
      <Card>
        <CardContent className="pt-6">
          <EmptyState icon={MessageCircle} title="Select a conversation" description="Choose a conversation to read its messages." />
        </CardContent>
      </Card>
    )
  }
  return (
    <Card>
      {query.isPending ? (
        <CardContent className="pt-6">
          <LoadingState label="Loading messages…" rows={4} />
        </CardContent>
      ) : query.isError ? (
        <CardContent className="pt-6">
          <ErrorState title="Could not load this conversation" error={query.error} onRetry={() => void query.refetch()} />
        </CardContent>
      ) : query.data === null ? (
        <CardContent className="pt-6">
          <EmptyState
            title="Conversation not found"
            description="It does not exist in this workspace."
            action={
              <button type="button" className="text-sm font-medium text-primary underline-offset-4 hover:underline" onClick={onClose}>
                Back to the inbox
              </button>
            }
          />
        </CardContent>
      ) : (
        <Thread conversation={query.data} />
      )}
    </Card>
  )
}

function Thread({ conversation }: { conversation: WhatsAppConversation }) {
  const headingId = useId()
  const { contact } = conversation
  return (
    <section aria-labelledby={headingId}>
      <CardHeader>
        <CardTitle id={headingId} className="flex flex-wrap items-center gap-2">
          {contactName(contact)}
          {contact.tenantId ? (
            <AppLink to={`/tenants/${encodeURIComponent(contact.tenantId)}`} className="text-sm font-normal text-primary hover:underline">
              Tenant: {contact.tenantName ?? 'view tenant'}
            </AppLink>
          ) : (
            <Badge variant="outline">Contact</Badge>
          )}
        </CardTitle>
        <CardDescription>
          {contact.phoneNumber ?? 'WhatsApp did not share this person’s number'} · to {conversation.companyNumber}
          {conversation.lastInboundAt ? (
            <>
              {' '}
              · last message from them <DateDisplay value={conversation.lastInboundAt} style="datetime" />
            </>
          ) : null}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {conversation.messages.length === 0 ? (
          <EmptyState title="No messages" description="This conversation has no messages yet." />
        ) : (
          <ol className="flex flex-col gap-3" aria-label="Messages">
            {conversation.messages.map((message) => {
              const inbound = message.direction === 'inbound'
              return (
                <li key={message.id} className={cn('flex', inbound ? 'justify-start' : 'justify-end')}>
                  <div
                    className={cn(
                      'max-w-[85%] rounded-lg border px-3 py-2 text-sm',
                      inbound ? 'border-border bg-muted text-foreground' : 'border-primary/30 bg-primary/10 text-foreground',
                    )}
                  >
                    <p className="sr-only">{inbound ? 'Received' : 'Sent'}</p>
                    <p className="whitespace-pre-wrap break-words">{message.body}</p>
                    <p className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <DateDisplay value={messageTime(message)} style="datetime" />
                      {inbound ? null : <StatusBadge status={message.status} />}
                    </p>
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </CardContent>
    </section>
  )
}
