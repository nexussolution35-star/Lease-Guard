import {
  WHATSAPP_VERIFICATION_STEPS,
  type WhatsAppBusinessAccount,
  type WhatsAppPhoneNumber,
  type WhatsAppVerificationStepResult,
} from '@leaseguard/domain'

import type { Tables } from '../../infrastructure/database/database.types'

/**
 * The whatsapp_phone_numbers columns members may read (migration 20261110100400): everything but the
 * credential reference, which only the worker reads with the service role. Every API query of numbers
 * selects these explicitly, so the reference cannot reach a response.
 */
// One literal (not concatenated), so supabase-js can type the selected row.
export const NUMBER_COLUMNS =
  'id, company_id, business_account_id, phone_number_id, display_name, display_number, verified_name, quality_rating, code_verification_status, name_status, meta_status, webhook_configured, connection_status, last_verified_at, registration_blocked_until, messaging_limit_tier, disconnected_at, disconnected_reason, operator_imported_at, created_at'

export type NumberRow = Pick<
  Tables<'whatsapp_phone_numbers'>,
  | 'id'
  | 'company_id'
  | 'business_account_id'
  | 'phone_number_id'
  | 'display_name'
  | 'display_number'
  | 'verified_name'
  | 'quality_rating'
  | 'code_verification_status'
  | 'name_status'
  | 'meta_status'
  | 'webhook_configured'
  | 'connection_status'
  | 'last_verified_at'
  | 'registration_blocked_until'
  | 'messaging_limit_tier'
  | 'disconnected_at'
  | 'disconnected_reason'
  | 'operator_imported_at'
  | 'created_at'
>

export const STEP_COLUMNS = 'number_id, step, status, message, recovery, meta_error_code, checked_at'
export type StepRow = Pick<
  Tables<'whatsapp_number_verification_steps'>,
  'number_id' | 'step' | 'status' | 'message' | 'recovery' | 'meta_error_code' | 'checked_at'
>

function toStepResult(row: StepRow): WhatsAppVerificationStepResult {
  return {
    step: row.step,
    status: row.status,
    ...(row.message ? { message: row.message } : {}),
    ...(row.recovery ? { recovery: row.recovery } : {}),
    ...(row.meta_error_code ? { metaErrorCode: row.meta_error_code } : {}),
    ...(row.checked_at ? { checkedAt: row.checked_at } : {}),
  }
}

export const BUSINESS_ACCOUNT_COLUMNS = 'id, company_id, business_account_id, name, created_at'
export type BusinessAccountRow = Pick<Tables<'whatsapp_business_accounts'>, 'id' | 'company_id' | 'business_account_id' | 'name' | 'created_at'>

/** Row → domain number. Picks fields one by one, so a wider row (service role) never leaks a column. */
export function toWhatsAppPhoneNumber(row: NumberRow, steps: readonly StepRow[] = []): WhatsAppPhoneNumber {
  return {
    id: row.id,
    businessAccountId: row.business_account_id,
    phoneNumberId: row.phone_number_id,
    displayName: row.display_name,
    displayNumber: row.display_number,
    ...(row.verified_name ? { verifiedName: row.verified_name } : {}),
    ...(row.quality_rating ? { qualityRating: row.quality_rating } : {}),
    ...(row.code_verification_status ? { codeVerificationStatus: row.code_verification_status } : {}),
    ...(row.name_status ? { nameStatus: row.name_status } : {}),
    ...(row.meta_status ? { metaStatus: row.meta_status } : {}),
    webhookConfigured: row.webhook_configured,
    connectionStatus: row.connection_status,
    ...(row.last_verified_at ? { lastVerifiedAt: row.last_verified_at } : {}),
    ...(row.registration_blocked_until ? { registrationBlockedUntil: row.registration_blocked_until } : {}),
    ...(row.messaging_limit_tier ? { messagingLimitTier: row.messaging_limit_tier } : {}),
    ...(row.connection_status === 'disconnected' && row.disconnected_at ? { disconnectedAt: row.disconnected_at } : {}),
    ...(row.connection_status === 'disconnected' && row.disconnected_reason ? { disconnectedReason: row.disconnected_reason } : {}),
    ...(row.operator_imported_at ? { operatorImportedAt: row.operator_imported_at } : {}),
    verificationSteps: steps
      .filter((step) => step.number_id === row.id)
      .sort((a, b) => WHATSAPP_VERIFICATION_STEPS.indexOf(a.step) - WHATSAPP_VERIFICATION_STEPS.indexOf(b.step))
      .map(toStepResult),
    createdAt: row.created_at,
  }
}

/** Oldest first, ties by id: the order the channel module uses to choose a company's default number. */
function byAge(a: { created_at: string; id: string }, b: { created_at: string; id: string }): number {
  return a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)
}

/**
 * A company's accounts with their numbers. Both lists must already be one company's rows; a number is
 * listed under the account with its business account id (the database guarantees one exists).
 */
export function toWhatsAppBusinessAccounts(
  accounts: readonly BusinessAccountRow[],
  numbers: readonly NumberRow[],
  steps: readonly StepRow[] = [],
): WhatsAppBusinessAccount[] {
  const sortedNumbers = [...numbers].sort(byAge)
  return [...accounts].sort(byAge).map((account) => ({
    id: account.id,
    businessAccountId: account.business_account_id,
    ...(account.name ? { name: account.name } : {}),
    numbers: sortedNumbers.filter((n) => n.business_account_id === account.business_account_id).map((n) => toWhatsAppPhoneNumber(n, steps)),
    createdAt: account.created_at,
  }))
}
