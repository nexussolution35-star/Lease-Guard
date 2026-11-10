import type { Company, WhatsAppSummary } from '@leaseguard/domain'

import type { Tables } from '../../infrastructure/database/database.types'
import { defaultNumber } from '../../infrastructure/whatsapp/channel-readiness'

export type CompanyRow = Tables<'companies'>
/** The number columns the company summary needs; never the credential reference. */
export type WhatsAppSummaryRow = Pick<Tables<'whatsapp_phone_numbers'>, 'id' | 'connection_status' | 'created_at'>
export const WHATSAPP_SUMMARY_COLUMNS = 'id, connection_status, created_at'

/** The company fields shown in the workspace switcher. */
export type CompanySummary = Pick<Company, 'id' | 'name' | 'tradingName' | 'initials' | 'status'>
export type CompanySummaryRow = Pick<CompanyRow, 'id' | 'name' | 'trading_name' | 'initials' | 'status'>

/**
 * The company's numbers at a glance. The status is that of the number the company sends from by default
 * (the WhatsApp channel module's rule), so "connected" here means the outbound gate finds a channel.
 */
export function toWhatsAppSummary(numbers: readonly WhatsAppSummaryRow[]): WhatsAppSummary {
  return {
    connectionStatus: defaultNumber(numbers)?.connection_status ?? 'not_configured',
    numberCount: numbers.length,
    connectedNumberCount: numbers.filter((number) => number.connection_status === 'connected').length,
  }
}

/**
 * Database row (settings stored as typed columns) plus its WhatsApp numbers → domain `Company`.
 * Nullable columns become absent optional fields. `country` and `timezone` are fixed by CHECK
 * constraints, so they map to the domain's literal values.
 */
export function toCompany(row: CompanyRow, whatsappNumbers: readonly WhatsAppSummaryRow[]): Company {
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
    whatsapp: toWhatsAppSummary(whatsappNumbers),
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
