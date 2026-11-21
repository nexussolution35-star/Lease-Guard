import type { Tenant } from '@leaseguard/domain'
import { describe, expect, it } from 'vitest'

import { sampleRecord } from '@/test/fakeApi'

import { newTenantFormDefaults, newTenantFrom, tenantChangesFrom, tenantErrorField, tenantFormDefaults, tenantFormSchema } from './tenantFormSchema'

const TENANT: Tenant = {
  ...sampleRecord('tenants'),
  legalName: 'Soweto Shoes (Pty) Ltd',
  tradingName: 'Soweto Shoes',
  businessType: 'pty_ltd',
  primaryContact: { fullName: 'Sizwe Mabena', role: 'Owner', phone: '+27825550199' },
  whatsappNumber: '+27825550199',
  status: 'active',
  industry: 'Retail',
}
delete TENANT.registrationNumber
delete TENANT.vatNumber
delete TENANT.email
delete TENANT.notes

const filled = { ...newTenantFormDefaults(), legalName: ' Soweto Shoes (Pty) Ltd ', businessType: 'pty_ltd' as const, contactFullName: 'Sizwe Mabena', whatsappNumber: '082 555 0199' }

describe('tenantFormSchema', () => {
  it('stores the WhatsApp number in E.164, with the same rule the API applies', () => {
    expect(tenantFormSchema.parse(filled).whatsappNumber).toBe('+27825550199')
    expect(tenantFormSchema.parse({ ...filled, whatsappNumber: '+44 20 7946 0958' }).whatsappNumber).toBe('+442079460958')
  })

  it('refuses an invalid number with the format to use, and the other required fields', () => {
    const result = tenantFormSchema.safeParse({ ...newTenantFormDefaults(), whatsappNumber: '12345', contactEmail: 'not-an-email' })
    expect(result.success).toBe(false)
    const messages = Object.fromEntries(result.error!.issues.map((issue) => [issue.path.join('.'), issue.message]))
    expect(messages).toMatchObject({
      legalName: 'Enter the registered business name',
      businessType: 'Choose a business type',
      contactFullName: 'Enter the contact person',
      whatsappNumber: 'Enter the WhatsApp number with its country code, for example +27 82 123 4567',
      contactEmail: 'Enter a valid email address',
    })
  })
})

describe('newTenantFrom', () => {
  it('sends the required fields and leaves empty optional ones to the API', () => {
    expect(newTenantFrom(tenantFormSchema.parse(filled))).toEqual({
      legalName: 'Soweto Shoes (Pty) Ltd',
      businessType: 'pty_ltd',
      primaryContact: { fullName: 'Sizwe Mabena' },
      whatsappNumber: '+27825550199',
      status: 'prospective',
    })
  })

  it('sends every optional field that is filled in', () => {
    const body = newTenantFrom(
      tenantFormSchema.parse({ ...filled, tradingName: 'Soweto Shoes', contactRole: 'Owner', contactEmail: 'sizwe@example.co.za', email: 'accounts@example.co.za', vatNumber: '4123456789', notes: 'Prefers mornings' }),
    )
    expect(body).toMatchObject({
      tradingName: 'Soweto Shoes',
      primaryContact: { fullName: 'Sizwe Mabena', role: 'Owner', email: 'sizwe@example.co.za' },
      email: 'accounts@example.co.za',
      vatNumber: '4123456789',
      notes: 'Prefers mornings',
    })
  })
})

describe('tenantChangesFrom', () => {
  const values = (changes: Partial<ReturnType<typeof tenantFormDefaults>> = {}) => tenantFormSchema.parse({ ...tenantFormDefaults(TENANT), ...changes })

  it('is null when nothing changed, including a number typed differently', () => {
    expect(tenantChangesFrom(values(), TENANT)).toBeNull()
    expect(tenantChangesFrom(values({ whatsappNumber: '082 555 0199' }), TENANT)).toBeNull()
  })

  it('sends only the changed fields, the number in E.164 and the contact person as a partial', () => {
    expect(tenantChangesFrom(values({ whatsappNumber: '082 555 0111', contactRole: 'Director', status: 'in_arrears' }), TENANT)).toEqual({
      whatsappNumber: '+27825550111',
      status: 'in_arrears',
      primaryContact: { role: 'Director' },
    })
  })

  it('clears an emptied optional field with null and falls back for the trading name and contact phone', () => {
    const withExtras: Tenant = { ...TENANT, email: 'accounts@example.co.za', notes: 'Old note', tradingName: 'Shoes', primaryContact: { ...TENANT.primaryContact, phone: '011 555 0100' } }
    const changes = tenantChangesFrom(tenantFormSchema.parse({ ...tenantFormDefaults(withExtras), email: '', notes: ' ', tradingName: '', contactPhone: '' }), withExtras)
    expect(changes).toEqual({ email: null, notes: null, tradingName: 'Soweto Shoes (Pty) Ltd', primaryContact: { phone: '+27825550199' } })
  })
})

describe('tenantErrorField', () => {
  it('puts a 400 that names a field on that field, without the field name', () => {
    expect(tenantErrorField(400, ['whatsappNumber: Enter the WhatsApp number with its country code, for example +27 82 123 4567'])).toEqual({
      field: 'whatsappNumber',
      message: 'Enter the WhatsApp number with its country code, for example +27 82 123 4567',
    })
    expect(tenantErrorField(400, ['primaryContact.email: must be a valid email address'])).toEqual({ field: 'contactEmail', message: 'Must be a valid email address' })
  })

  it('leaves anything else above the form', () => {
    expect(tenantErrorField(400, ['Change at least one field'])).toBeNull()
    expect(tenantErrorField(403, ['whatsappNumber: x'])).toBeNull()
  })
})
