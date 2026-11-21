import type { AuditLogDto, MonitoringEventTargetStatus } from '@leaseguard/api-client'
import type { AuditScalar, MonitoringEventStatus, MonitoringEventType } from '@leaseguard/domain'

import type { ActivityTimelineEntry } from '@/components/shared'
import { labelFor, type Tone } from '@/lib/labels'

/**
 * Words for the monitoring event detail screen: what the figures of a calculation mean for each event type, the
 * workflow actions and how a status change reads in the event's history. Presentation only: which moves are allowed
 * comes from the domain workflow (`nextEventStatuses`), and every figure from the event the API returns.
 */

/** What the expected, actual and difference figures of an event's calculation are, per event type. */
export interface CalculationLabels {
  expected: string
  actual: string
  difference: string
}

const DEFAULT_LABELS: CalculationLabels = { expected: 'Expected', actual: 'Actual', difference: 'Difference' }

const CALCULATION_LABELS: Partial<Record<MonitoringEventType, CalculationLabels>> = {
  rental_escalation_discrepancy: { expected: 'Expected rental', actual: 'Billed rental', difference: 'Difference' },
  guarantee_shortfall: { expected: 'Required guarantee', actual: 'Guarantee held', difference: 'Shortfall' },
  deposit_shortfall: { expected: 'Required deposit', actual: 'Deposit held', difference: 'Shortfall' },
  arrears: { expected: 'Expected', actual: 'Outstanding balance', difference: 'Difference' },
  arrangement_attention: { expected: 'Due in the period', actual: 'Payments received', difference: 'Shortfall' },
}

export function calculationLabels(type: MonitoringEventType): CalculationLabels {
  return CALCULATION_LABELS[type] ?? DEFAULT_LABELS
}

/** Where the expected figure of an event type comes from, for the calculation's source line. */
export const EXPECTED_SOURCE: Partial<Record<MonitoringEventType, string>> = {
  rental_escalation_discrepancy: 'Expected from the verified lease terms; billed from the verified statement.',
  guarantee_shortfall: 'Required from the verified lease terms and the rental expected today.',
  deposit_shortfall: 'Required from the verified lease terms and the rental expected today.',
  arrears: 'Outstanding balance from the latest verified statement.',
  arrangement_attention: 'Due from the arrangement and the verified statement; received from the statement.',
}

/** A workflow action: the button that moves an event to `to`, and the dialog that confirms it. */
export interface StatusAction {
  /** Button and submit label. */
  label: string
  /** Dialog title. */
  title: string
  description: string
}

export const STATUS_ACTIONS: Readonly<Record<MonitoringEventTargetStatus, StatusAction>> = {
  under_review: {
    label: 'Start review',
    title: 'Start reviewing this event',
    description: 'Moves the event to under review, so others see someone is checking it. Your name and the time are recorded.',
  },
  action_required: {
    label: 'Mark action required',
    title: 'Mark this event as needing action',
    description: 'The review found something to do. Your name and the time are recorded in the history.',
  },
  in_progress: {
    label: 'Start work',
    title: 'Start working on this event',
    description: 'Moves the event to in progress while the action is carried out. Your name and the time are recorded.',
  },
  resolved: {
    label: 'Resolve',
    title: 'Resolve this event',
    description: 'Closes the event as handled. It cannot be reopened, and the same finding is not raised again. Your name and the time are recorded.',
  },
  dismissed: {
    label: 'Dismiss',
    title: 'Dismiss this event',
    description:
      'Closes the event without action, for example when the finding is not a real issue. It cannot be reopened, and the same finding is not raised again. Say why: the reason, your name and the time are recorded.',
  },
}

/**
 * The actions to show for `nextStatuses` (from the domain workflow), in button order: dismissing first, the forward
 * step last, because the forward step is the view's one primary action and the primary action sits last on the right.
 */
export function orderedActions(nextStatuses: readonly MonitoringEventStatus[]): MonitoringEventTargetStatus[] {
  const targets = nextStatuses.filter((status): status is MonitoringEventTargetStatus => status in STATUS_ACTIONS)
  return [...targets.filter((status) => status === 'dismissed'), ...targets.filter((status) => status !== 'dismissed')]
}

function changeOf(log: AuditLogDto, field: string): { before: AuditScalar; after: AuditScalar } | undefined {
  return log.changes?.find((change) => change.field === field)
}

function text(value: AuditScalar | undefined): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

const ACTION_TONE: Partial<Record<AuditLogDto['action'], Tone>> = { resolve: 'success', dismiss: 'neutral' }

/**
 * One audit entry of an event as a history entry: the status it moved from and to, with the note given with the move
 * (the dismissal reason, or the resolution notes). An entry written before notes were recorded with the move falls back
 * to its summary, which names a dismissal's reason.
 */
export function historyEntryFrom(log: AuditLogDto, actorName: string | undefined): ActivityTimelineEntry {
  const status = changeOf(log, 'status')
  const note = text(changeOf(log, 'dismissal_reason')?.after) ?? text(changeOf(log, 'resolution_notes')?.after)
  const title =
    status && typeof status.before === 'string' && typeof status.after === 'string'
      ? `${labelFor(status.before)} → ${labelFor(status.after)}`
      : log.summary
  const description = note ?? (status && log.action === 'dismiss' ? log.summary : undefined)
  return {
    id: log.id,
    title,
    ...(description ? { description } : {}),
    at: log.occurredAt,
    ...(actorName ? { actor: actorName } : {}),
    tone: ACTION_TONE[log.action] ?? 'neutral',
  }
}
