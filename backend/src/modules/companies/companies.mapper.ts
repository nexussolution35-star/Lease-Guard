import type { Company, WhatsAppAccountConfig } from '@leaseguard/domain'

import type { Tables } from '../../infrastructure/database/database.types'

export type CompanyRow = Tables<'companies'>
export type WhatsAppAccountRow = Tables<'whatsapp_accounts'>

/** The company fields shown in the workspace switcher. */
export type CompanySummary = Pick<Company, 'id' | 'name' | 'tradingName' | 'initials' | 'status'>
export type CompanySummaryRow = Pick<CompanyRow, 'id' | 'name' | 'trading_name' | 'initials' | 'status'>

/**
 * A company without a `whatsapp_accounts` row has not set up WhatsApp Business. The domain models that
 * as connection status `not_configured`; the account identifiers are empty because none exist.
 */
export const NOT_CONFIGURED_WHATSAPP: WhatsAppAccountConfig = {
  businessAccountId: '',
  phoneNumberId: '',
  displayName: '',
  displayNumber: '',
  accessTokenReference: '',
  webhookConfigured: false,
  connectionStatus: 'not_configured',
}

/** `whatsapp_accounts` row → domain `WhatsAppAccountConfig` (non-secret references only). */
export function toWhatsAppAccountConfig(row: WhatsAppAccountRow | null): WhatsAppAccountConfig {
  if (!row) return NOT_CONFIGURED_WHATSAPP
  return {
    businessAccountId: row.business_account_id,
    phoneNumberId: row.phone_number_id,
    displayName: row.display_name,
    displayNumber: row.display_number,
    accessTokenReference: row.access_token_reference,
    webhookConfigured: row.webhook_configured,
    connectionStatus: row.connection_status,
    ...(row.last_verified_at ? { lastVerifiedAt: row.last_verified_at } : {}),
  }
}

/**
 * Database row (settings stored as typed columns) plus its WhatsApp account → domain `Company`.
 * Nullable columns become absent optional fields. `country` and `timezone` are fixed by CHECK
 * constraints, so they map to the domain's literal values.
 */
export function toCompany(row: CompanyRow, whatsapp: WhatsAppAccountRow | null): Company {
  return {
    id: row.id,
    name: row.name,
    ...(row.trading_name ? { tradingName: row.trading_name } : {}),
    ...(row.registration_number ? { registrationNumber: row.registration_number } : {}),
    ...(row.vat_number ? { vatNumber: row.vat_number } : {}),
    address: {
      line1: row.address_line1,
      ...(row.address_line2 ? { line2: row.address_line2 } : {}),
      suburb: row.suburb,
      city: row.city,
      province: row.province,
      postalCode: row.postal_code,
      country: 'South Africa',
    },
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    status: row.status,
    initials: row.initials,
    whatsapp: toWhatsAppAccountConfig(whatsapp),
    settings: {
      leaseExpiryNoticeDays: row.lease_expiry_notice_days,
      renewalDeadlineWarningDays: row.renewal_deadline_warning_days,
      guaranteeExpiryNoticeDays: row.guarantee_expiry_notice_days,
      paymentReminderOffsetsDays: {
        initial: row.payment_reminder_initial_days,
        overdue: row.payment_reminder_overdue_days,
        followUp: row.payment_reminder_follow_up_days,
      },
      installmentReminderLeadDays: row.installment_reminder_lead_days,
      ownerSummaryWeekday: row.owner_summary_weekday,
      timezone: 'Africa/Johannesburg',
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function toCompanySummary(row: CompanySummaryRow): CompanySummary {
  return {
    id: row.id,
    name: row.name,
    ...(row.trading_name ? { tradingName: row.trading_name } : {}),
    initials: row.initials,
    status: row.status,
  }
}
