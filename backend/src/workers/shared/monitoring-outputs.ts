import type {
  EntityId,
  EntityType,
  EventCalculation,
  EventPriority,
  ISODate,
  MonitoringEventType,
  NotificationSeverity,
  NotificationType,
} from '@leaseguard/domain'

import type { Json, TablesInsert } from '../../infrastructure/database/database.types'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import { chunk, unwrap } from './db'

/**
 * A monitoring finding to raise. `dedupeKey` identifies the finding deterministically (see the
 * 20261109100100_monitoring_dedupe_keys migration): raising the same key again is a no-op.
 */
export interface EventDraft {
  dedupeKey: string
  type: MonitoringEventType
  propertyId: EntityId
  unitId?: EntityId
  tenantId?: EntityId
  leaseId?: EntityId
  leaseReference?: string
  statementId?: EntityId
  arrangementId?: EntityId
  ruleId?: EntityId
  title: string
  description: string
  calculation?: EventCalculation
  identifiedOn: ISODate
  dueDate?: ISODate
  priority: EventPriority
  recommendedAction: string
  /** The property manager responsible; also the recipient of the high/critical notification. */
  assignedToUserId?: EntityId
}

/** An in-app notification for one user. `dedupeKey` must include the recipient. */
export interface NotificationDraft {
  dedupeKey: string
  userId: EntityId
  type: NotificationType
  severity: NotificationSeverity
  title: string
  body: string
  link?: { entityType: EntityType; entityId: EntityId }
}

/** Priorities that notify the responsible property manager. */
export const NOTIFY_PRIORITIES: readonly EventPriority[] = ['high', 'critical']

const WRITE_BATCH = 200
const LOOKUP_BATCH = 100

function toJsonCalculation(calculation: EventCalculation): Json {
  return {
    ...(calculation.expectedAmount === undefined ? {} : { expectedAmount: calculation.expectedAmount }),
    ...(calculation.actualAmount === undefined ? {} : { actualAmount: calculation.actualAmount }),
    ...(calculation.difference === undefined ? {} : { difference: calculation.difference }),
    steps: [...calculation.steps],
  }
}

/** Event draft → insert row. company_id always comes from the job, never from loaded data. */
export function toEventInsert(companyId: EntityId, draft: EventDraft): TablesInsert<'monitoring_events'> {
  return {
    company_id: companyId,
    dedupe_key: draft.dedupeKey,
    type: draft.type,
    property_id: draft.propertyId,
    unit_id: draft.unitId ?? null,
    tenant_id: draft.tenantId ?? null,
    lease_id: draft.leaseId ?? null,
    lease_reference: draft.leaseReference ?? null,
    statement_id: draft.statementId ?? null,
    arrangement_id: draft.arrangementId ?? null,
    rule_id: draft.ruleId ?? null,
    title: draft.title,
    description: draft.description,
    calculation: draft.calculation ? toJsonCalculation(draft.calculation) : null,
    identified_on: draft.identifiedOn,
    due_date: draft.dueDate ?? null,
    priority: draft.priority,
    recommended_action: draft.recommendedAction,
    assigned_to_user_id: draft.assignedToUserId ?? null,
    status: 'new',
  }
}

export function toNotificationInsert(companyId: EntityId, draft: NotificationDraft): TablesInsert<'notifications'> {
  return {
    company_id: companyId,
    dedupe_key: draft.dedupeKey,
    user_id: draft.userId,
    type: draft.type,
    severity: draft.severity,
    title: draft.title,
    body: draft.body,
    link_entity_type: draft.link?.entityType ?? null,
    link_entity_id: draft.link?.entityId ?? null,
  }
}

export interface RaiseResult {
  /** Events inserted by this call (keys not seen before). */
  created: number
  /** Notifications inserted by this call. */
  notified: number
}

/**
 * Writes monitoring outputs for ONE company through the service-role client. Every insert is an
 * `ON CONFLICT (company_id, dedupe_key) DO NOTHING`, so daily re-scans and retried jobs never create
 * duplicates.
 */
export class MonitoringOutputs {
  constructor(
    private readonly db: DbClient,
    private readonly companyId: EntityId,
  ) {}

  /**
   * Raises the events, then notifies the assigned property manager of every high/critical event among
   * them that is still open. Notifications are keyed by event and recipient, so a manager is told
   * once; if a previous attempt created the events but crashed before notifying, the retry catches up.
   * Pass `notify: false` when the caller sends its own, more specific notification.
   */
  async raise(drafts: readonly EventDraft[], options: { notify?: boolean } = {}): Promise<RaiseResult> {
    let created = 0
    for (const batch of chunk(drafts, WRITE_BATCH)) {
      const result = await this.db
        .from('monitoring_events')
        .upsert(
          batch.map((draft) => toEventInsert(this.companyId, draft)),
          { onConflict: 'company_id,dedupe_key', ignoreDuplicates: true },
        )
        .select('id')
      const inserted = unwrap(result, 'Raise monitoring events', [])
      created += inserted.length
    }

    if (options.notify === false) return { created, notified: 0 }
    const notifiable = drafts.filter((draft) => NOTIFY_PRIORITIES.includes(draft.priority) && draft.assignedToUserId)
    const notifications: NotificationDraft[] = []
    for (const batch of chunk(notifiable.map((draft) => draft.dedupeKey), LOOKUP_BATCH)) {
      const result = await this.db
        .from('monitoring_events')
        .select('id, title, description, priority, status, assigned_to_user_id')
        .eq('company_id', this.companyId)
        .in('dedupe_key', batch)
        .in('priority', [...NOTIFY_PRIORITIES])
        .not('status', 'in', '(resolved,dismissed)')
      const events = unwrap(result, 'Look up raised events', [])
      for (const event of events) {
        if (!event.assigned_to_user_id) continue
        notifications.push({
          dedupeKey: `monitoring_event:${event.id}:${event.assigned_to_user_id}`,
          userId: event.assigned_to_user_id,
          type: 'monitoring_event',
          severity: event.priority === 'critical' ? 'critical' : 'warning',
          title: event.title,
          body: event.description,
          link: { entityType: 'monitoring_event', entityId: event.id },
        })
      }
    }
    const notified = await this.notify(notifications)
    return { created, notified }
  }

  /** Inserts notifications, ignoring keys that already exist. Returns how many were new. */
  async notify(drafts: readonly NotificationDraft[]): Promise<number> {
    let notified = 0
    for (const batch of chunk(drafts, WRITE_BATCH)) {
      const result = await this.db
        .from('notifications')
        .upsert(
          batch.map((draft) => toNotificationInsert(this.companyId, draft)),
          { onConflict: 'company_id,dedupe_key', ignoreDuplicates: true },
        )
        .select('id')
      const inserted = unwrap(result, 'Create notifications', [])
      notified += inserted.length
    }
    return notified
  }
}
