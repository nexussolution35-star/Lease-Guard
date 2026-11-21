import type { MessageTypeTemplate } from '@leaseguard/domain'
import { RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { PageHeader } from '@/components/layout/PageHeader'
import { AppLink, EmptyState, ErrorState, LoadingState, NoActiveWorkspace, SectionHeader } from '@/components/shared'
import { Button } from '@/components/ui/button'
import { useIsCompanyAdmin } from '@/features/account/useActiveRole'
import { describeApiError } from '@/lib/data/apiErrors'
import { isAwaitingWorkspace } from '@/lib/data/queries'

import { useMessageTemplateSettings, useSyncMessageTemplates } from '../api/queries'
import { ChooseTemplateDialog } from './ChooseTemplateDialog'
import { MessageTypeTemplateRow } from './MessageTypeTemplateRow'

/** How long the page keeps reading the settings again after a sync was requested. */
const SYNC_WATCH_MS = 30_000

/**
 * Settings → Message templates: every LeaseGuard message type with the Meta-approved WhatsApp template that sends it.
 * Company admins choose the template of each type and sync the templates from Meta again; other members read. The API
 * and the database enforce every rule (tenant types only take Utility statement and payment templates, never bank
 * details, changes audited); the page explains them.
 */
export function MessageTemplatesSettingsScreen() {
  const isAdmin = useIsCompanyAdmin()
  const [syncedAt, setSyncedAt] = useState<number | null>(null)
  const settings = useMessageTemplateSettings({ polling: syncedAt !== null })
  const sync = useSyncMessageTemplates()
  const [choosing, setChoosing] = useState<MessageTypeTemplate | null>(null)

  // Stop reading again once the sync has had time to finish.
  useEffect(() => {
    if (syncedAt === null) return
    const timer = window.setTimeout(() => setSyncedAt(null), SYNC_WATCH_MS)
    return () => window.clearTimeout(timer)
  }, [syncedAt])

  const connected = settings.data?.whatsappConnected ?? false

  async function syncAgain() {
    try {
      const result = await sync.mutateAsync()
      setSyncedAt(Date.now())
      toast.success('Syncing templates from Meta', { description: result.message })
    } catch (error) {
      toast.error('The templates could not be synced', { description: describeApiError(error, 'Try again in a moment.') })
    }
  }

  const header = (
    <PageHeader
      title="Message templates"
      actions={
        isAdmin && connected ? (
          <Button type="button" onClick={() => void syncAgain()} disabled={sync.isPending}>
            <RefreshCw aria-hidden="true" className={sync.isPending ? 'animate-spin motion-reduce:animate-none' : undefined} />
            Sync templates
          </Button>
        ) : null
      }
    />
  )

  if (isAwaitingWorkspace(settings)) {
    return (
      <section>
        {header}
        <NoActiveWorkspace />
      </section>
    )
  }

  const types = settings.data?.types ?? []
  const tenantTypes = types.filter((t) => t.audience === 'tenant')
  const ownerTypes = types.filter((t) => t.audience === 'property_owner')
  const anyMapped = types.some((t) => t.mapping !== undefined)
  const choose = isAdmin ? (type: MessageTypeTemplate) => () => setChoosing(type) : undefined

  return (
    <section>
      {header}
      {settings.isPending ? <LoadingState label="Loading message templates…" rows={4} /> : null}
      {settings.isError ? (
        <ErrorState title="Message templates could not be loaded" error={settings.error} onRetry={() => void settings.refetch()} />
      ) : null}
      {settings.data ? (
        <div className="flex flex-col gap-10">
          {isAdmin ? null : (
            <p className="text-sm text-foreground">
              You can see which WhatsApp template sends each message. Only company admins choose templates or sync them from Meta.
            </p>
          )}
          {connected ? null : (
            <EmptyState
              title="WhatsApp is not connected"
              description="Templates are synced from the WhatsApp Business Account of a connected number. Connect WhatsApp, then choose a template for each message."
              action={
                <AppLink
                  to="/settings/integrations/whatsapp"
                  className="inline-flex h-9 items-center rounded-md border border-border px-4 text-sm font-medium text-foreground transition-colors duration-150 hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none motion-reduce:transition-none"
                >
                  Set up WhatsApp
                </AppLink>
              }
              className="border-y border-border"
            />
          )}
          {connected || anyMapped ? (
            <>
              <section aria-label="Tenant messages" className="space-y-3">
                <SectionHeader
                  title="Tenant messages"
                  description="Tenants only ever receive these statement and payment messages, and only once a property manager approves each one. Escalation, lease expiry, renewal, dispute and guarantee matters are never sent to tenants."
                />
                <ul className="divide-y divide-border border-y border-border">
                  {tenantTypes.map((type) => (
                    <MessageTypeTemplateRow key={type.messageType} type={type} {...(choose ? { onChoose: choose(type) } : {})} />
                  ))}
                </ul>
              </section>
              <section aria-label="Owner messages" className="space-y-3">
                <SectionHeader title="Owner messages" description="Sent to property owners of the workspace." />
                <ul className="divide-y divide-border border-y border-border">
                  {ownerTypes.map((type) => (
                    <MessageTypeTemplateRow key={type.messageType} type={type} {...(choose ? { onChoose: choose(type) } : {})} />
                  ))}
                </ul>
              </section>
              <p className="text-xs text-muted-foreground italic">
                Templates never carry bank details: LeaseGuard monitors statements and arrangements and never collects payments. Every change of
                template is recorded in the audit log.
              </p>
            </>
          ) : null}
        </div>
      ) : null}
      {isAdmin && choosing ? (
        <ChooseTemplateDialog
          open
          onOpenChange={(open) => {
            if (!open) setChoosing(null)
          }}
          type={choosing}
          types={types}
        />
      ) : null}
    </section>
  )
}
