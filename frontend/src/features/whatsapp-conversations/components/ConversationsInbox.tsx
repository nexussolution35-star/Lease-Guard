import { Bot } from 'lucide-react'
import { useId } from 'react'
import type { Communication, EntityId, WhatsAppAgentRun } from '@leaseguard/domain'

import { PageHeader } from '@/components/layout/PageHeader'
import { AppLink, DataTablePagination, DateDisplay, EmptyState, ErrorState, LoadingState, NoActiveWorkspace, StatusBadge, StatusDot } from '@/components/shared'
import { Button } from '@/components/ui/button'
import { useCurrentUserId } from '@/features/account/useActiveRole'
import { isAwaitingWorkspace } from '@/lib/data/queries'
import { cn } from '@/lib/utils'

import { useConversation, useConversationList } from '../api/queries'
import type { ConversationFilter, WhatsAppConversation, WhatsAppConversationSummary } from '../api/source'
import { agentReplyIds, agentRunSummary, runsByMessage } from '../agentRun'
import { handoverStatusText } from '../handover'
import { HandoverPanel } from './HandoverPanel'
import { ReplyBox } from './ReplyBox'

export interface InboxParams {
  page: number
  pageSize: number
  /** Only handed-over conversations, or those assigned to the signed-in user. */
  filter?: ConversationFilter
  /** The open conversation. */
  conversation?: EntityId
}

const FILTERS: readonly { value: ConversationFilter | undefined; label: string }[] = [
  { value: undefined, label: 'All' },
  { value: 'handed_over', label: 'Handed over' },
  { value: 'mine', label: 'Assigned to me' },
]

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
 * The WhatsApp conversations inbox of the active workspace: conversations, most recent first (all, handed over, or
 * assigned to me), and the open conversation's messages with its handover and the reply box. Messages arrive
 * through Meta's webhook, routed to this workspace by the number they were sent to; the inbox refreshes itself.
 */
export function ConversationsInbox({ params, onParamsChange }: ConversationsInboxProps) {
  const list = useConversationList({ page: params.page, pageSize: params.pageSize, ...(params.filter ? { filter: params.filter } : {}) })
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
    // From lg the page fills the viewport below the shell (top bar 3rem, page padding 1.5rem + 3rem), so the pane takes what is left.
    <section className="lg:flex lg:h-[calc(100svh-7.5rem)] lg:flex-col">
      {header}
      <p className="mb-4 max-w-prose text-sm text-pretty text-muted-foreground">
        Company admins and property managers can take conversations over and reply to contacts within 24 hours of their last message.
        Tenants are never answered automatically or with free-form replies: they only receive approved statement and payment messages.
      </p>
      {/* One frame: the list and the open conversation scroll on their own from lg, and stack below it. */}
      <div className="grid overflow-hidden rounded-lg border border-border bg-card lg:min-h-[32rem] lg:flex-1 lg:grid-cols-[22rem_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]">
        <ConversationList
          query={list}
          selected={params.conversation}
          onSelect={select}
          filter={params.filter}
          onFilterChange={(filter) => {
            const { filter: _previous, ...rest } = params
            onParamsChange({ ...rest, page: 1, ...(filter ? { filter } : {}) })
          }}
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
  filter,
  onFilterChange,
  page,
  pageSize,
  onPageChange,
}: {
  query: ReturnType<typeof useConversationList>
  selected: EntityId | undefined
  onSelect: (id: EntityId) => void
  filter: ConversationFilter | undefined
  onFilterChange: (filter: ConversationFilter | undefined) => void
  page: number
  pageSize: number
  onPageChange: (page: number) => void
}) {
  const headingId = useId()
  const currentUserId = useCurrentUserId()
  return (
    <section aria-labelledby={headingId} className="flex min-h-0 flex-col border-b border-border lg:border-r lg:border-b-0">
      <div className="space-y-2 border-b border-border p-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 id={headingId} className="text-sm font-medium text-foreground">
            Inbox
          </h2>
          {query.data ? (
            <p className="text-xs text-muted-foreground tabular-nums">
              {query.data.total === 1 ? '1 conversation' : `${query.data.total} conversations`}
            </p>
          ) : null}
        </div>
        <div role="group" aria-label="Show" className="-mx-1 flex flex-wrap gap-1">
          {FILTERS.map(({ value, label }) => (
            <Button
              key={label}
              type="button"
              size="sm"
              variant={filter === value ? 'secondary' : 'ghost'}
              aria-pressed={filter === value}
              className="h-7 px-2"
              onClick={() => onFilterChange(value)}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {query.isPending ? (
          <LoadingState label="Loading conversations…" rows={4} className="p-3" />
        ) : query.isError ? (
          <ErrorState title="Could not load conversations" error={query.error} onRetry={() => void query.refetch()} className="border-0" />
        ) : query.data.items.length === 0 ? (
          <EmptyState
            title="No conversations yet"
            description="When someone messages one of this workspace's connected WhatsApp numbers, the conversation appears here."
            className="items-center px-4 text-center"
          />
        ) : (
          <ul className="divide-y divide-border" aria-label="Conversations">
            {query.data.items.map((conversation) => {
              const isSelected = conversation.id === selected
              return (
                <li key={conversation.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(conversation.id)}
                    aria-current={isSelected ? 'true' : undefined}
                    className={cn(
                      'flex w-full flex-col gap-0.5 px-3 py-3 text-left transition-colors duration-150 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none',
                      isSelected ? 'bg-accent' : 'hover:bg-muted/50',
                    )}
                  >
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-medium text-foreground">{contactName(conversation.contact)}</span>
                      <DateDisplay value={conversation.lastMessageAt} style="datetime" className="shrink-0 text-xs text-muted-foreground tabular-nums" />
                    </span>
                    {conversation.lastMessagePreview ? (
                      <span className="truncate text-sm text-muted-foreground">{conversation.lastMessagePreview}</span>
                    ) : null}
                    <span className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground tabular-nums">
                      {conversation.contact.tenantName ? <span>Tenant · {conversation.contact.tenantName}</span> : null}
                      <span>To {conversation.companyNumber}</span>
                      {conversation.handover ? (
                        <StatusDot tone={conversation.handover.status === 'accepted' ? 'success' : 'warning'} className="h-4 text-xs">
                          {handoverStatusText(conversation.handover, currentUserId)}
                        </StatusDot>
                      ) : null}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      {query.data && query.data.total > pageSize ? (
        <DataTablePagination page={page} pageSize={pageSize} total={query.data.total} onPageChange={onPageChange} className="border-t border-border px-3 py-2" />
      ) : null}
    </section>
  )
}

function ConversationThread({ id, onClose }: { id: EntityId | undefined; onClose: () => void }) {
  const query = useConversation(id)
  if (id === undefined) {
    return <EmptyState title="Select a conversation" description="Choose a conversation to read its messages." className="items-center justify-center px-4 text-center" />
  }
  if (query.isPending) return <LoadingState label="Loading messages…" rows={4} className="p-4" />
  if (query.isError) {
    return <ErrorState title="Could not load this conversation" error={query.error} onRetry={() => void query.refetch()} className="self-start border-0" />
  }
  if (query.data === null) {
    return (
      <EmptyState
        title="Conversation not found"
        description="It does not exist in this workspace."
        className="px-4"
        action={
          <button type="button" className="text-sm font-medium text-primary underline-offset-4 hover:underline" onClick={onClose}>
            Back to the inbox
          </button>
        }
      />
    )
  }
  return <Thread conversation={query.data} />
}

/** What the AI agent did with an inbound message, for staff only; its suggested reply was never sent. */
function AgentRunNote({ run }: { run: WhatsAppAgentRun }) {
  return (
    <div className="max-w-[85%] rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground" role="note">
      <p className="flex items-center gap-1.5 font-medium text-foreground">
        <Bot className="size-3.5" aria-hidden="true" />
        {agentRunSummary(run)}
      </p>
      {run.handoverReason ? <p className="mt-1">Reason: {run.handoverReason}</p> : null}
      {run.suggestedReply ? (
        <div className="mt-2">
          <p className="font-medium text-foreground">Suggested reply (internal, not sent)</p>
          <p className="mt-0.5 whitespace-pre-wrap break-words text-foreground">{run.suggestedReply}</p>
        </div>
      ) : null}
    </div>
  )
}

function Thread({ conversation }: { conversation: WhatsAppConversation }) {
  const headingId = useId()
  const { contact } = conversation
  const runs = runsByMessage(conversation.agentRuns)
  const agentReplies = agentReplyIds(conversation.agentRuns)
  return (
    <section aria-labelledby={headingId} className="flex min-h-0 flex-col">
      <header className="space-y-0.5 border-b border-border px-4 py-3">
        <h2 id={headingId} className="flex flex-wrap items-baseline gap-x-2 text-base font-medium text-balance text-foreground">
          {contactName(contact)}
          {contact.tenantId ? (
            <AppLink to={`/tenants/${encodeURIComponent(contact.tenantId)}`} className="text-sm font-normal text-primary hover:underline">
              Tenant: {contact.tenantName ?? 'view tenant'}
            </AppLink>
          ) : (
            <span className="text-xs font-normal text-muted-foreground">Contact</span>
          )}
        </h2>
        <p className="text-xs text-muted-foreground tabular-nums">
          {contact.phoneNumber ?? 'WhatsApp did not share this person’s number'} · to {conversation.companyNumber}
          {conversation.lastInboundAt ? (
            <>
              {' '}
              · last message from them <DateDisplay value={conversation.lastInboundAt} style="datetime" />
            </>
          ) : null}
        </p>
      </header>
      <HandoverPanel conversation={conversation} />
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {conversation.messages.length === 0 ? (
          <EmptyState title="No messages" description="This conversation has no messages yet." className="py-0" />
        ) : (
          <ol className="flex flex-col gap-4" aria-label="Messages">
            {conversation.messages.map((message) => {
              const inbound = message.direction === 'inbound'
              const run = inbound ? runs.get(message.id) : undefined
              return (
                <li key={message.id} className={cn('flex flex-col gap-1', inbound ? 'items-start' : 'items-end')}>
                  <div className={cn('max-w-[85%] rounded-lg px-3 py-2 text-sm text-foreground', inbound ? 'bg-muted' : 'border border-border bg-background')}>
                    <p className="sr-only">{inbound ? 'Received' : 'Sent'}</p>
                    <p className="whitespace-pre-wrap break-words">{message.body}</p>
                  </div>
                  <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <DateDisplay value={messageTime(message)} style="datetime" />
                    {inbound ? null : <StatusBadge status={message.status} className="text-xs" />}
                    {agentReplies.has(message.id) ? (
                      <span className="inline-flex items-center gap-1">
                        <Bot className="size-3.5" aria-hidden="true" />
                        Sent by the AI agent
                      </span>
                    ) : null}
                  </p>
                  {run ? <AgentRunNote run={run} /> : null}
                </li>
              )
            })}
          </ol>
        )}
      </div>
      <ReplyBox conversation={conversation} />
    </section>
  )
}
