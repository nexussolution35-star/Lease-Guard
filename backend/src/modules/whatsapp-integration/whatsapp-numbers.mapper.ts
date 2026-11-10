import type { WhatsAppBusinessAccount, WhatsAppPhoneNumber } from '@leaseguard/domain'

import type { Tables } from '../../infrastructure/database/database.types'

/**
 * The whatsapp_phone_numbers columns members may read (migration 20261110100400): everything but the
 * credential reference, which only the worker reads with the service role. Every API query of numbers
 * selects these explicitly, so the reference cannot reach a response.
 */
// One literal (not concatenated), so supabase-js can type the selected row.
export const NUMBER_COLUMNS =
  'id, company_id, business_account_id, phone_number_id, display_name, display_number, verified_name, quality_rating, code_verification_status, name_status, meta_status, webhook_configured, connection_status, last_verified_at, created_at'

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
  | 'created_at'
>

export const BUSINESS_ACCOUNT_COLUMNS = 'id, company_id, business_account_id, name, created_at'
export type BusinessAccountRow = Pick<Tables<'whatsapp_business_accounts'>, 'id' | 'company_id' | 'business_account_id' | 'name' | 'created_at'>

/** Row → domain number. Picks fields one by one, so a wider row (service role) never leaks a column. */
export function toWhatsAppPhoneNumber(row: NumberRow): WhatsAppPhoneNumber {
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
export function toWhatsAppBusinessAccounts(accounts: readonly BusinessAccountRow[], numbers: readonly NumberRow[]): WhatsAppBusinessAccount[] {
  const sortedNumbers = [...numbers].sort(byAge)
  return [...accounts].sort(byAge).map((account) => ({
    id: account.id,
    businessAccountId: account.business_account_id,
    ...(account.name ? { name: account.name } : {}),
    numbers: sortedNumbers.filter((n) => n.business_account_id === account.business_account_id).map(toWhatsAppPhoneNumber),
    createdAt: account.created_at,
  }))
}
