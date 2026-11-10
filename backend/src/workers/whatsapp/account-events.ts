import type { EntityId } from '@leaseguard/domain'
import { z } from 'zod'

import type { RoutingOutcome } from './inbound-routing'

/**
 * Meta's account-level webhooks (ticket 06): `account_update`, `message_template_status_update` and
 * `phone_number_quality_update`. They carry no receiving number, only the WhatsApp Business Account (the entry id,
 * or `waba_info.waba_id`), so they apply to the companies that hold verified access to that account
 * (whatsapp_business_account_holders, 20261110101000): a stored business token or a connected number. A company that
 * only typed the same account id is never affected. The store answers per company it applied the change to.
 */

/** Events after which LeaseGuard no longer has access to the account. */
export const ACCESS_REMOVAL_EVENTS = ['PARTNER_APP_UNINSTALLED', 'PARTNER_REMOVED', 'ACCOUNT_DELETED', 'ACCOUNT_OFFBOARDED'] as const
export type AccessRemovalEvent = (typeof ACCESS_REMOVAL_EVENTS)[number]

export interface AccessRemoval {
  companyId: EntityId
  numbersDisconnected: number
  tokenRemoved: boolean
  adminsNotified: number
}

export interface TemplateStatusChange {
  /** Meta's template id (digits). */
  metaTemplateId: string
  name: string | null
  language: string | null
  category: string | null
  /** Meta's status, upper case, e.g. APPROVED, PAUSED, DELETED. */
  status: string
  reason: string | null
}

/** added | updated | removed | stale (older than what LeaseGuard holds) | unknown_template (cannot be placed). */
export type TemplateStatusOutcome = 'added' | 'updated' | 'removed' | 'stale' | 'unknown_template'

export interface QualityUpdate {
  /** The number Meta names, digits only. */
  displayPhoneNumber: string | null
  event: string
  messagingLimitTier: string | null
}

/** refreshed: Meta's view of the numbers was read again; meta_unavailable: no usable credential or Meta refused. */
export type QualityRefreshOutcome = 'refreshed' | 'meta_unavailable'

export interface AccountEventStore {
  removeAccess(businessAccountId: string, event: AccessRemovalEvent, occurredAt: Date | null): Promise<AccessRemoval[]>
  applyTemplateStatus(
    businessAccountId: string,
    change: TemplateStatusChange,
    occurredAt: Date | null,
  ): Promise<{ companyId: EntityId; outcome: TemplateStatusOutcome }[]>
  refreshNumberQuality(
    businessAccountId: string,
    update: QualityUpdate,
    occurredAt: Date | null,
  ): Promise<{ companyId: EntityId; outcome: QualityRefreshOutcome; numbers: number }[]>
}

/** One account-level change of a payload, with the entry's account and time. */
export interface AccountChange {
  businessAccountId: string | null
  occurredAt: Date | null
  value: unknown
}

export interface AccountEvents {
  /** The outcomes of one change, or null when the field is not an account-level field LeaseGuard handles. */
  route(field: string, change: AccountChange): Promise<RoutingOutcome[] | null>
}

const metaId = z.union([z.string(), z.number()]).transform((v) => String(v).trim()).pipe(z.string().regex(/^[0-9]{1,32}$/))
const text = (max: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v && v.trim() !== '' ? v.trim().slice(0, max) : null))

const accountUpdateSchema = z.object({
  event: z.string().min(1).max(100),
  waba_info: z
    .object({ waba_id: metaId.optional().catch(undefined), partner_app_id: metaId.optional().catch(undefined) })
    .partial()
    .optional()
    .catch(undefined),
})

const templateStatusSchema = z.object({
  event: z.string().min(1).max(40),
  message_template_id: metaId.optional().catch(undefined),
  message_template_name: text(512),
  message_template_language: text(20),
  message_template_category: text(40),
  reason: text(200),
})

const qualitySchema = z.object({
  event: z.string().min(1).max(60),
  display_phone_number: z.string().optional(),
  max_daily_conversations_per_business: text(40),
  current_limit: text(40),
})

/**
 * The `event` values of message_template_status_update that name the template's new status (research doc 6.5), and
 * REINSTATED, which returns a template to approved. Every other event (UNARCHIVED, LOCKED, or one Meta adds later)
 * does not say what the status now is, so it is recorded as not_handled and leaves the template as it is; the next
 * template sync reads the real status. Passing such an event on as a status would mark a sendable template rejected.
 */
export const TEMPLATE_STATUS_EVENTS = [
  'APPROVED',
  'REJECTED',
  'PENDING',
  'PAUSED',
  'DISABLED',
  'FLAGGED',
  'IN_APPEAL',
  'LIMIT_EXCEEDED',
  'ARCHIVED',
  'DELETED',
  'PENDING_DELETION',
] as const
const TEMPLATE_STATUS_OF_EVENT: Readonly<Record<string, string>> = {
  ...Object.fromEntries(TEMPLATE_STATUS_EVENTS.map((status) => [status, status])),
  REINSTATED: 'APPROVED',
}

const isRemoval = (event: string): event is AccessRemovalEvent => (ACCESS_REMOVAL_EVENTS as readonly string[]).includes(event)

export function accountEvents(deps: { store: AccountEventStore; appId?: string | undefined }): AccountEvents {
  const noAccount = (field: string): RoutingOutcome[] => [{ field, outcome: 'invalid', reason: 'account event without a WhatsApp Business Account' }]

  return {
    async route(field, change) {
      switch (field) {
        case 'account_update': {
          const parsed = accountUpdateSchema.safeParse(change.value)
          if (!parsed.success) return [{ field, outcome: 'invalid', reason: 'account update without an event' }]
          const { event, waba_info: info } = parsed.data
          const businessAccountId = info?.waba_id ?? change.businessAccountId
          if (!businessAccountId) return noAccount(field)
          const base = { field, businessAccountId, event }
          if (!isRemoval(event)) return [{ ...base, outcome: 'not_handled' }]
          if (deps.appId && info?.partner_app_id && info.partner_app_id !== deps.appId) return [{ ...base, outcome: 'other_app' }]
          const removals = await deps.store.removeAccess(businessAccountId, event, change.occurredAt)
          if (removals.length === 0) return [{ ...base, outcome: 'no_holder' }]
          return removals.map((r) => ({ ...base, companyId: r.companyId, outcome: 'disconnected', numbersDisconnected: r.numbersDisconnected, tokenRemoved: r.tokenRemoved, adminsNotified: r.adminsNotified }))
        }
        case 'message_template_status_update': {
          const parsed = templateStatusSchema.safeParse(change.value)
          if (!parsed.success || !parsed.data.message_template_id) {
            return [{ field, outcome: 'invalid', reason: 'template status without a template id' }]
          }
          if (!change.businessAccountId) return noAccount(field)
          const v = parsed.data
          const event = v.event.trim().toUpperCase()
          const status = TEMPLATE_STATUS_OF_EVENT[event]
          if (!status) {
            return [{ field, businessAccountId: change.businessAccountId, templateId: v.message_template_id!, event, outcome: 'not_handled' }]
          }
          const templateChange: TemplateStatusChange = {
            metaTemplateId: v.message_template_id!,
            name: v.message_template_name,
            language: v.message_template_language,
            category: v.message_template_category,
            status,
            reason: v.reason,
          }
          const results = await deps.store.applyTemplateStatus(change.businessAccountId, templateChange, change.occurredAt)
          const base = { field, businessAccountId: change.businessAccountId, templateId: templateChange.metaTemplateId, status: templateChange.status }
          if (results.length === 0) return [{ ...base, outcome: 'no_holder' }]
          return results.map((r) => ({ ...base, companyId: r.companyId, outcome: r.outcome }))
        }
        case 'phone_number_quality_update': {
          const parsed = qualitySchema.safeParse(change.value)
          if (!parsed.success) return [{ field, outcome: 'invalid', reason: 'quality update without an event' }]
          if (!change.businessAccountId) return noAccount(field)
          const v = parsed.data
          const digits = v.display_phone_number?.replace(/\D/g, '') ?? ''
          const update: QualityUpdate = {
            displayPhoneNumber: digits === '' ? null : digits.slice(0, 20),
            event: v.event.trim().toUpperCase(),
            messagingLimitTier: v.max_daily_conversations_per_business ?? v.current_limit,
          }
          const results = await deps.store.refreshNumberQuality(change.businessAccountId, update, change.occurredAt)
          const base = { field, businessAccountId: change.businessAccountId, event: update.event }
          if (results.length === 0) return [{ ...base, outcome: 'no_holder' }]
          return results.map((r) => ({ ...base, companyId: r.companyId, outcome: r.outcome, numbers: r.numbers }))
        }
        default:
          return null
      }
    },
  }
}
