import type { EntityId } from '@leaseguard/domain'

import type { TablesInsert, TablesUpdate } from '../../infrastructure/database/database.types'
import type { CreateTenantBody, UpdateTenantBody } from './tenants.schemas'

/**
 * Columns a person writes. The company (on update), the timestamps and the WhatsApp validation (flag and sign-off) and
 * opt-out are not among them: the column grants refuse them for signed-in users.
 */
type FixedColumns =
  | 'whatsapp_verified'
  | 'whatsapp_validated_at'
  | 'whatsapp_validated_by_user_id'
  | 'whatsapp_opted_out'
  | 'id'
  | 'created_at'
  | 'updated_at'
export type TenantInsert = Omit<TablesInsert<'tenants'>, FixedColumns>
export type TenantChanges = Omit<TablesUpdate<'tenants'>, FixedColumns | 'company_id'>

/**
 * POST /tenants body → row. The trading name is the registered name when omitted, the contact phone the WhatsApp
 * number, and a new tenant is prospective. The number is already E.164 (the body schema normalised it).
 */
export function tenantInsertFrom(companyId: EntityId, body: CreateTenantBody): TenantInsert {
  return {
    company_id: companyId,
    legal_name: body.legalName,
    trading_name: body.tradingName ?? body.legalName,
    business_type: body.businessType,
    registration_number: body.registrationNumber ?? null,
    account_reference: body.accountReference ?? null,
    vat_number: body.vatNumber ?? null,
    contact_full_name: body.primaryContact.fullName,
    contact_role: body.primaryContact.role ?? '',
    contact_phone: body.primaryContact.phone ?? body.whatsappNumber,
    contact_email: body.primaryContact.email ?? null,
    whatsapp_number: body.whatsappNumber,
    email: body.email ?? null,
    status: body.status ?? 'prospective',
    industry: body.industry ?? '',
    notes: body.notes ?? null,
  }
}

/** PATCH /tenants/:tenantId body → the columns it changes; omitted fields are left out, null clears. */
export function tenantChangesFrom(body: UpdateTenantBody): TenantChanges {
  const contact = body.primaryContact
  return {
    ...(body.legalName !== undefined ? { legal_name: body.legalName } : {}),
    ...(body.tradingName !== undefined ? { trading_name: body.tradingName } : {}),
    ...(body.businessType !== undefined ? { business_type: body.businessType } : {}),
    ...(body.registrationNumber !== undefined ? { registration_number: body.registrationNumber } : {}),
    ...(body.accountReference !== undefined ? { account_reference: body.accountReference } : {}),
    ...(body.vatNumber !== undefined ? { vat_number: body.vatNumber } : {}),
    ...(contact?.fullName !== undefined ? { contact_full_name: contact.fullName } : {}),
    ...(contact?.role !== undefined ? { contact_role: contact.role } : {}),
    ...(contact?.phone !== undefined ? { contact_phone: contact.phone } : {}),
    ...(contact?.email !== undefined ? { contact_email: contact.email } : {}),
    ...(body.whatsappNumber !== undefined ? { whatsapp_number: body.whatsappNumber } : {}),
    ...(body.email !== undefined ? { email: body.email } : {}),
    ...(body.status !== undefined ? { status: body.status } : {}),
    ...(body.industry !== undefined ? { industry: body.industry } : {}),
    ...(body.notes !== undefined ? { notes: body.notes } : {}),
  }
}
