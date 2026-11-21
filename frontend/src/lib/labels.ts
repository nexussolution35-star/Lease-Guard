import { RENEWAL_DEADLINE_THRESHOLDS, type DeliveryOutcome, type MessageTypeTemplateStatus } from '@leaseguard/domain'

/**
 * Display labels and visual tones for every LeaseGuard enum value.
 * Components must use these helpers instead of hardcoding enum text.
 */

/** Visual tone used by badges and indicators; maps to semantic tokens. */
export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'primary'

const LABEL_OVERRIDES: Readonly<Record<string, string>> = {
  // roles
  company_admin: 'Company admin',
  property_manager: 'Property manager',
  property_owner: 'Property owner',
  read_only: 'Read only',
  // property and unit types
  shopping_centre: 'Shopping centre',
  industrial_warehouse: 'Industrial / warehouse',
  mixed_use: 'Mixed use',
  anchor_retail: 'Anchor retail',
  line_shop: 'Line shop',
  office_suite: 'Office suite',
  // tenant business types
  pty_ltd: '(Pty) Ltd',
  close_corporation: 'Close corporation (CC)',
  sole_proprietor: 'Sole proprietor',
  npc: 'Non-profit company (NPC)',
  // lease
  pending_verification: 'Pending verification',
  fixed_amount: 'Fixed amount',
  cpi_linked: 'CPI-linked',
  managing_agent: 'Managing agent',
  attorney_trust: 'Attorney trust account',
  signed_lease: 'Signed lease',
  renewal_agreement: 'Renewal agreement',
  bank_guarantee: 'Bank guarantee',
  deposit_receipt: 'Deposit receipt',
  fica: 'FICA documents',
  // statements
  review_required: 'Review required',
  operating_costs: 'Operating costs',
  rates_and_taxes: 'Rates and taxes',
  marketing_levy: 'Marketing levy',
  other_charge: 'Other charge',
  pending_review: 'Pending review',
  tenant_name: 'Tenant name',
  unit_number: 'Unit number',
  statement_number: 'Statement number',
  statement_date: 'Statement date',
  period_start: 'Period start',
  period_end: 'Period end',
  opening_balance: 'Opening balance',
  rental_charged: 'Rental charged',
  additional_charges: 'Additional charges',
  payments_received: 'Payments received',
  outstanding_balance: 'Outstanding balance',
  total_due: 'Total due',
  // monitoring
  rental_escalation_discrepancy: 'Rental escalation discrepancy',
  lease_expiry: 'Lease expiry',
  renewal_notice_deadline: 'Renewal notice deadline',
  guarantee_expiry: 'Guarantee expiry',
  guarantee_shortfall: 'Guarantee shortfall',
  deposit_shortfall: 'Deposit shortfall',
  arrangement_attention: 'Arrangement needs attention',
  statement_review_required: 'Statement review required',
  next_7_days: 'Due within 7 days',
  next_30_days: 'Due within 30 days',
  next_90_days: 'Due within 90 days',
  under_review: 'Under review',
  action_required: 'Action required',
  in_progress: 'In progress',
  // arrangements
  reminder_sent: 'Reminder sent',
  confirmed_paid: 'Confirmed paid',
  // communications
  monthly_statement: 'Monthly statement',
  initial_payment_reminder: 'Initial payment reminder',
  overdue_payment_reminder: 'Overdue payment reminder',
  follow_up_payment_reminder: 'Follow-up payment reminder',
  arrangement_installment_reminder: 'Instalment reminder',
  owner_weekly_summary: 'Owner weekly summary',
  owner_query_response: 'Owner query response',
  inbound_reply: 'Inbound reply',
  pending_approval: 'Pending approval',
  not_configured: 'Not configured',
  whatsapp: 'WhatsApp',
  en_ZA: 'English (South Africa)',
  af: 'Afrikaans',
  en: 'English',
  // lease expiry buckets and renewal deadlines (reports)
  months_0_3: 'Within 3 months',
  months_3_6: '3–6 months',
  months_6_12: '6–12 months',
  later: 'Later than 12 months',
  due_critical: `Due within ${RENEWAL_DEADLINE_THRESHOLDS.critical} days`,
  due_soon: `Due within ${RENEWAL_DEADLINE_THRESHOLDS.soon} days`,
  upcoming: `Due within ${RENEWAL_DEADLINE_THRESHOLDS.upcoming} days`,
  exercised: 'Option exercised',
  // approval waiting time (communication activity report)
  under_1_day: 'Under a day',
  '1_3_days': '1–3 days',
  '3_7_days': '3–7 days',
  over_7_days: 'More than 7 days',
  // audit
  workspace_switch: 'Workspace switch',
  reset_demo_data: 'Reset demo data',
}

/** Human label for any enum value, e.g. `under_review` → `Under review`. */
export function labelFor(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  const override = LABEL_OVERRIDES[value]
  if (override) return override
  const spaced = value.replace(/_/g, ' ').trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

const TONES: Readonly<Record<string, Tone>> = {
  // generic lifecycle
  active: 'success',
  archived: 'neutral',
  suspended: 'warning',
  deactivated: 'neutral',
  invited: 'info',
  draft: 'neutral',
  // occupancy
  occupied: 'success',
  vacant: 'warning',
  under_offer: 'info',
  unavailable: 'neutral',
  under_development: 'info',
  // tenant
  in_arrears: 'danger',
  notice_given: 'warning',
  vacated: 'neutral',
  prospective: 'info',
  // lease
  pending_verification: 'warning',
  expiring: 'warning',
  expired: 'danger',
  renewed: 'info',
  terminated: 'neutral',
  released: 'neutral',
  called: 'danger',
  // statements
  uploaded: 'info',
  processing: 'info',
  review_required: 'warning',
  verified: 'success',
  rejected: 'danger',
  duplicate: 'neutral',
  pending_review: 'warning',
  confirmed: 'success',
  corrected: 'info',
  // monitoring
  new: 'primary',
  under_review: 'info',
  action_required: 'danger',
  in_progress: 'warning',
  resolved: 'success',
  dismissed: 'neutral',
  // arrangements
  proposed: 'info',
  completed: 'success',
  defaulted: 'danger',
  cancelled: 'neutral',
  scheduled: 'neutral',
  reminder_sent: 'info',
  confirmed_paid: 'success',
  missed: 'danger',
  waived: 'neutral',
  // communications
  pending_approval: 'warning',
  pending: 'warning',
  approved: 'success',
  queued: 'info',
  sent: 'info',
  delivered: 'success',
  read: 'success',
  failed: 'danger',
  received: 'primary',
  submitted: 'info',
  // whatsapp connection
  connected: 'success',
  not_configured: 'neutral',
  pending_verification_whatsapp: 'warning',
  disconnected: 'warning',
  error: 'danger',
  // lease expiry buckets and renewal deadlines (reports)
  months_0_3: 'warning',
  due_critical: 'danger',
  due_soon: 'warning',
  upcoming: 'info',
  exercised: 'success',
  // rental comparison outcome (reports)
  outside_tolerance: 'danger',
  within_tolerance: 'success',
  // priorities
  low: 'neutral',
  medium: 'info',
  high: 'warning',
  critical: 'danger',
}

/** Visual tone for a status or priority value. Unknown values are neutral. */
export function toneFor(value: string | null | undefined): Tone {
  if (!value) return 'neutral'
  return TONES[value] ?? 'neutral'
}

/** Text colour for a status label. The hue is carried by a dot or icon beside it, never a tinted pill. */
export const TONE_CLASSES: Readonly<Record<Tone, string>> = {
  neutral: 'text-muted-foreground',
  info: 'text-foreground',
  success: 'text-foreground',
  warning: 'text-foreground',
  danger: 'text-foreground',
  primary: 'text-foreground',
}

/** Build `{ value, label }` options for selects from an enum tuple. */
export function enumOptions<T extends string>(values: readonly T[]): { value: T; label: string }[] {
  return values.map((value) => ({ value, label: labelFor(value) }))
}

/** Status groups of the monitoring list's status filter (one status, or all open or all closed events). */
export const MONITORING_STATUS_GROUP_LABELS: Readonly<Record<'open' | 'closed', string>> = {
  open: 'Open (needs attention)',
  closed: 'Closed (resolved or dismissed)',
}

/** Settings → Message templates: whether a message type can be sent with its template (`messageTypeTemplateState`). */
export const MESSAGE_TEMPLATE_STATE_LABELS: Readonly<Record<MessageTypeTemplateStatus, string>> = {
  not_mapped: 'No template',
  ready: 'Ready to send',
  waiting_on_meta: 'Waiting on Meta',
  rejected: 'Not approved by Meta',
  removed: 'Removed by Meta',
  text_changed: 'Text changed',
}

export const MESSAGE_TEMPLATE_STATE_TONES: Readonly<Record<MessageTypeTemplateStatus, Tone>> = {
  not_mapped: 'neutral',
  ready: 'success',
  waiting_on_meta: 'info',
  rejected: 'danger',
  removed: 'danger',
  text_changed: 'warning',
}

/** What became of a message handed to WhatsApp for sending (communication activity report). */
export const DELIVERY_OUTCOME_LABELS: Readonly<Record<DeliveryOutcome, string>> = {
  pending: 'Sent, not delivered yet',
  delivered: 'Delivered, not read',
  read: 'Read',
  failed: 'Failed',
}
