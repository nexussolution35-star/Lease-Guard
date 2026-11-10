import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import {
  hasCompanyDetails,
  onboardingChecklist,
  type Company,
  type EntityId,
  type OnboardingChecklist,
  type WhatsAppPhoneNumber,
} from '@leaseguard/domain'

import { httpErrorFromDatabase, unwrapDatabase, type DatabaseErrorLike } from '../../common/http/database-errors'
import type { CompanyContext } from '../../common/request-context'
import type { TablesInsert, TablesUpdate } from '../../infrastructure/database/database.types'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import { NUMBER_COLUMNS, toWhatsAppPhoneNumber } from '../whatsapp-integration/whatsapp-numbers.mapper'
import { toCompany, WHATSAPP_SUMMARY_COLUMNS, type CompanyRow, type WhatsAppSummaryRow } from './companies.mapper'
import type { ConfigureWhatsAppBody, UpdateCompanyBody } from './companies.schemas'

/**
 * Company columns, the summary columns of its WhatsApp numbers (never the credential reference) and the
 * caller's membership row. The inner join on `company_users` restricts results to companies the caller
 * belongs to explicitly, in addition to Row Level Security (which also requires an active profile).
 */
const COMPANY_SELECT = `*, whatsapp_phone_numbers(${WHATSAPP_SUMMARY_COLUMNS}), company_users!inner(user_id)`

type CompanyQueryRow = CompanyRow & { whatsapp_phone_numbers: WhatsAppSummaryRow[] | null }

/** The companies columns a company_admin may update (the database's column grants). */
type CompanyProfilePatch = Pick<
  TablesUpdate<'companies'>,
  | 'name'
  | 'trading_name'
  | 'registration_number'
  | 'vat_number'
  | 'address_line1'
  | 'address_line2'
  | 'suburb'
  | 'city'
  | 'province'
  | 'postal_code'
  | 'contact_email'
  | 'contact_phone'
  | 'lease_expiry_notice_days'
  | 'renewal_deadline_warning_days'
  | 'guarantee_expiry_notice_days'
  | 'payment_reminder_initial_days'
  | 'payment_reminder_overdue_days'
  | 'payment_reminder_follow_up_days'
  | 'installment_reminder_lead_days'
  | 'owner_summary_weekday'
>

/** The whatsapp_phone_numbers columns a company_admin may write (the database's column grants). */
type WhatsAppNumberInput = Pick<
  TablesInsert<'whatsapp_phone_numbers'>,
  'company_id' | 'business_account_id' | 'phone_number_id' | 'display_name' | 'display_number'
>

function fromQueryRow({ whatsapp_phone_numbers, ...row }: CompanyQueryRow & { company_users: unknown }): Company {
  return toCompany(row, whatsapp_phone_numbers ?? [])
}

/** Request body (only the fields given) → the granted company columns. */
export function toCompanyPatch(body: UpdateCompanyBody): CompanyProfilePatch {
  const patch: CompanyProfilePatch = {}
  if (body.name !== undefined) patch.name = body.name
  if (body.tradingName !== undefined) patch.trading_name = body.tradingName
  if (body.registrationNumber !== undefined) patch.registration_number = body.registrationNumber
  if (body.vatNumber !== undefined) patch.vat_number = body.vatNumber
  if (body.address) {
    patch.address_line1 = body.address.line1
    patch.address_line2 = body.address.line2 ?? null
    patch.suburb = body.address.suburb
    patch.city = body.address.city
    patch.province = body.address.province
    patch.postal_code = body.address.postalCode
  }
  if (body.contactEmail !== undefined) patch.contact_email = body.contactEmail
  if (body.contactPhone !== undefined) patch.contact_phone = body.contactPhone
  const settings = body.settings
  if (settings) {
    if (settings.leaseExpiryNoticeDays) patch.lease_expiry_notice_days = settings.leaseExpiryNoticeDays
    if (settings.renewalDeadlineWarningDays) patch.renewal_deadline_warning_days = settings.renewalDeadlineWarningDays
    if (settings.guaranteeExpiryNoticeDays) patch.guarantee_expiry_notice_days = settings.guaranteeExpiryNoticeDays
    if (settings.paymentReminderOffsetsDays) {
      patch.payment_reminder_initial_days = settings.paymentReminderOffsetsDays.initial
      patch.payment_reminder_overdue_days = settings.paymentReminderOffsetsDays.overdue
      patch.payment_reminder_follow_up_days = settings.paymentReminderOffsetsDays.followUp
    }
    if (settings.installmentReminderLeadDays !== undefined) patch.installment_reminder_lead_days = settings.installmentReminderLeadDays
    if (settings.ownerSummaryWeekday !== undefined) patch.owner_summary_weekday = settings.ownerSummaryWeekday
  }
  return patch
}

/**
 * Routes under /companies/:companyId that act on the active company must name the same company as
 * X-Company-Id, whose membership and role the guards verified.
 */
export function assertActiveCompany(companyId: EntityId, company: CompanyContext): void {
  if (companyId.toLowerCase() !== company.companyId) {
    throw new BadRequestException('The company in the path must be the active company (X-Company-Id)')
  }
}

/** A `head` count query's total, or the HTTP error matching its database error. */
function countOf(result: { count: number | null; error: DatabaseErrorLike | null }, operation: string): number {
  if (result.error) throw httpErrorFromDatabase(result.error, operation)
  return result.count ?? 0
}

/** Reads the companies (workspaces) the caller is a member of; company admins configure their company. */
@Injectable()
export class CompaniesService {
  /** Every company the caller belongs to, by name. A user has few companies, so this is not paged. */
  async list(db: DbClient, userId: EntityId): Promise<Company[]> {
    const { data, error } = await db
      .from('companies')
      .select(COMPANY_SELECT)
      .eq('company_users.user_id', userId)
      .order('name', { ascending: true })
      .order('id', { ascending: true })
    if (error) throw httpErrorFromDatabase(error, 'List companies')
    return (data ?? []).map(fromQueryRow)
  }

  /** One company the caller belongs to; 404 when it does not exist or the caller is not a member. */
  async get(db: DbClient, userId: EntityId, companyId: EntityId): Promise<Company> {
    const row = unwrapDatabase(
      await db
        .from('companies')
        .select(COMPANY_SELECT)
        .eq('company_users.user_id', userId)
        .eq('id', companyId)
        .maybeSingle(),
      'Get company',
    )
    return fromQueryRow(row)
  }

  /**
   * Updates the company profile and monitoring settings (company admins). Only the granted columns are
   * written; the database refuses anything else (42501 → 403) and checks the settings (e.g. reminder
   * offsets in order).
   */
  async update(db: DbClient, userId: EntityId, companyId: EntityId, body: UpdateCompanyBody): Promise<Company> {
    unwrapDatabase(
      await db.from('companies').update(toCompanyPatch(body)).eq('id', companyId).select('id').maybeSingle(),
      'Update company',
    )
    return this.get(db, userId, companyId)
  }

  /**
   * Adds a number by its Meta identifiers, or updates the company's number with that phone number id
   * (company admins). With `numberId` it corrects that number of the company instead (e.g. a mistyped
   * phone number or business account id), so a typo never leaves a second number behind; 404 when the
   * company has no such number. The database records its WhatsApp Business Account (and removes an
   * account the correction emptied), sets the access-token reference, and starts a new number (or
   * changed Meta ids) at `pending_verification` until the worker verifies it. Returns the number without
   * the credential reference.
   */
  async configureWhatsApp(db: DbClient, companyId: EntityId, body: ConfigureWhatsAppBody): Promise<WhatsAppPhoneNumber> {
    const fields: Omit<WhatsAppNumberInput, 'company_id'> = {
      business_account_id: body.businessAccountId,
      phone_number_id: body.phoneNumberId,
      display_name: body.displayName,
      display_number: body.displayNumber,
    }
    if (body.numberId !== undefined) {
      const corrected = unwrapDatabase(
        await db
          .from('whatsapp_phone_numbers')
          .update(fields)
          .eq('id', body.numberId)
          .eq('company_id', companyId)
          .select(NUMBER_COLUMNS)
          .maybeSingle(),
        'Correct WhatsApp number',
      )
      return toWhatsAppPhoneNumber(corrected)
    }
    const number: WhatsAppNumberInput = { company_id: companyId, ...fields }
    const row = unwrapDatabase(
      await db
        .from('whatsapp_phone_numbers')
        // access_token_reference is NOT NULL without a default, so the generated Insert type requires it,
        // but signed-in users have no grant on it: the prepare_account trigger always sets it.
        .upsert(number as TablesInsert<'whatsapp_phone_numbers'>, { onConflict: 'company_id,phone_number_id' })
        .select(NUMBER_COLUMNS)
        .single(),
      'Configure WhatsApp',
      // No receiving-number conflict can reach an admin: only connected numbers must be distinct across
      // companies (migration 20261110100100), and an admin's write either keeps the number's verified
      // identifiers or sends it back to pending verification. So configuring never reveals which
      // numbers other companies hold.
    )
    return toWhatsAppPhoneNumber(row)
  }

  /**
   * Onboarding progress of the company, read with the caller's client. Invitations are visible to
   * company admins only, so for other members `teamInvited` reflects the member count alone.
   */
  async onboarding(db: DbClient, companyId: EntityId): Promise<OnboardingChecklist> {
    const count = { count: 'exact', head: true } as const
    const [company, whatsapp, members, invitations, properties, verifiedLeases, statements] = await Promise.all([
      db.from('companies').select('*').eq('id', companyId).maybeSingle(),
      db.from('whatsapp_phone_numbers').select('connection_status').eq('company_id', companyId),
      db.from('company_users').select('user_id', count).eq('company_id', companyId),
      db.from('company_invitations').select('id', count).eq('company_id', companyId),
      db.from('properties').select('id', count).eq('company_id', companyId),
      db.from('leases').select('id', count).eq('company_id', companyId).eq('verified', true),
      db.from('statements').select('id', count).eq('company_id', companyId),
    ])
    if (company.error) throw httpErrorFromDatabase(company.error, 'Get company for onboarding')
    if (!company.data) throw new NotFoundException('The company was not found')
    if (whatsapp.error) throw httpErrorFromDatabase(whatsapp.error, 'Get WhatsApp account for onboarding')

    return onboardingChecklist(companyId, {
      companyDetails: hasCompanyDetails(toCompany(company.data, [])),
      whatsappConfigured: (whatsapp.data ?? []).length > 0,
      whatsappConnected: (whatsapp.data ?? []).some((number) => number.connection_status === 'connected'),
      teamInvited: countOf(members, 'Count members') > 1 || countOf(invitations, 'Count invitations') > 0,
      propertyAdded: countOf(properties, 'Count properties') > 0,
      leaseVerified: countOf(verifiedLeases, 'Count verified leases') > 0,
      statementUploaded: countOf(statements, 'Count statements') > 0,
    })
  }
}
