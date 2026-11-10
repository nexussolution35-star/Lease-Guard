import type { NumberRow } from '../whatsapp-integration/whatsapp-numbers.mapper'
import type { CompanyRow, WhatsAppSummaryRow } from './companies.mapper'

/** Test fixtures shared by the companies and auth tests. */
export const companyRow: CompanyRow = {
  id: '6f1d2c1e-0000-4000-8000-000000000001',
  name: 'Nexus Solution (Pty) Ltd',
  trading_name: 'Nexus Solution',
  registration_number: '2015/123456/07',
  vat_number: null,
  address_line1: '12 Rivonia Road',
  address_line2: null,
  suburb: 'Sandton',
  city: 'Johannesburg',
  province: 'Gauteng',
  postal_code: '2196',
  country: 'South Africa',
  contact_email: 'info@nexussolution.co.za',
  contact_phone: '+27 11 555 0100',
  status: 'active',
  initials: 'NS',
  lease_expiry_notice_days: [180, 90, 30],
  renewal_deadline_warning_days: [90, 60, 30],
  guarantee_expiry_notice_days: [90, 30],
  payment_reminder_initial_days: 3,
  payment_reminder_overdue_days: 10,
  payment_reminder_follow_up_days: 20,
  installment_reminder_lead_days: 3,
  owner_summary_weekday: 'monday',
  timezone: 'Africa/Johannesburg',
  created_at: '2026-01-01T08:00:00+00:00',
  updated_at: '2026-11-01T08:00:00+00:00',
}

/** A number as the companies queries read it: the summary columns only, never the credential reference. */
export const whatsappRow: WhatsAppSummaryRow = {
  id: '6f1d2c1e-0000-4000-8000-0000000000c1',
  connection_status: 'connected',
  created_at: '2026-01-01T08:00:00+00:00',
}

/** A number as the configure endpoint returns it (the explicit member-readable columns). */
export const numberRow: NumberRow = {
  id: '6f1d2c1e-0000-4000-8000-0000000000c1',
  company_id: companyRow.id,
  business_account_id: '102938475610',
  phone_number_id: '564738291045',
  display_name: 'Nexus Solution',
  display_number: '+27 11 555 0100',
  verified_name: null,
  quality_rating: null,
  code_verification_status: null,
  name_status: null,
  meta_status: null,
  webhook_configured: false,
  connection_status: 'pending_verification',
  last_verified_at: null,
  registration_blocked_until: null,
  created_at: '2026-11-01T08:00:00+00:00',
}
