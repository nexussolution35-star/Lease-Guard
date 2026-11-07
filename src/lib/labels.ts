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
  statement_date: 'Statement date',
  period_start: 'Period start',
  period_end: 'Period end',
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

/** Tailwind classes for a tone, using semantic tokens only. */
export const TONE_CLASSES: Readonly<Record<Tone, string>> = {
  neutral: 'bg-muted text-muted-foreground border-border',
  info: 'bg-info/10 text-info border-info/30',
  success: 'bg-success/10 text-success border-success/30',
  warning: 'bg-warning/15 text-foreground border-warning/40',
  danger: 'bg-destructive/10 text-destructive border-destructive/30',
  primary: 'bg-primary/10 text-primary border-primary/30',
}

/** Build `{ value, label }` options for selects from an enum tuple. */
export function enumOptions<T extends string>(values: readonly T[]): { value: T; label: string }[] {
  return values.map((value) => ({ value, label: labelFor(value) }))
}
