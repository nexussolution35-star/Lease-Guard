import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'

import { callsTo, fakeDb } from '../../common/testing/fake-db.test-helpers'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import { createTenantBodySchema, updateTenantBodySchema } from './tenants.schemas'
import { TenantsService } from './tenants.service'
import { COMPANY, tenantRow } from './tenants.test-helpers'

const minimal = {
  legalName: '  Soweto Shoes (Pty) Ltd ',
  businessType: 'pty_ltd',
  primaryContact: { fullName: 'Sizwe Mabena' },
  whatsappNumber: '082 555 0199',
}

/** The 400 messages the validation pipe answers with. */
function messagesFor(schema: typeof createTenantBodySchema | typeof updateTenantBodySchema, body: unknown): string[] {
  try {
    new ZodValidationPipe(schema).transform(body)
  } catch (error) {
    if (error instanceof BadRequestException) return (error.getResponse() as { message: string[] }).message
    throw error
  }
  throw new Error('expected the body to be refused')
}

describe('tenant write schemas', () => {
  it('stores a typed South African number in E.164', () => {
    expect(createTenantBodySchema.parse(minimal)).toMatchObject({ legalName: 'Soweto Shoes (Pty) Ltd', whatsappNumber: '+27825550199' })
    expect(updateTenantBodySchema.parse({ whatsappNumber: '+27 82 555 0199' })).toEqual({ whatsappNumber: '+27825550199' })
  })

  it('refuses an invalid number with a message that says what to enter', () => {
    expect(messagesFor(createTenantBodySchema, { ...minimal, whatsappNumber: '12345' })).toEqual([
      'whatsappNumber: Enter the WhatsApp number with its country code, for example +27 82 123 4567',
    ])
    expect(messagesFor(updateTenantBodySchema, { whatsappNumber: '+27 082 555 0199' })).toEqual([
      'whatsappNumber: A South African WhatsApp number has nine digits after +27, for example +27 82 123 4567',
    ])
    expect(messagesFor(updateTenantBodySchema, { whatsappNumber: ' ' })).toEqual(['whatsappNumber: Enter the WhatsApp number'])
  })

  it('requires the registered name and the contact person, and checks emails', () => {
    expect(messagesFor(createTenantBodySchema, { ...minimal, legalName: ' ', primaryContact: { fullName: '' }, email: 'not-an-email' })).toEqual([
      'legalName: Enter the registered business name',
      'primaryContact.fullName: Enter the contact person',
      'email: must be a valid email address',
    ])
  })

  it('never accepts the validation or opt-out flags, or the company', () => {
    for (const extra of [{ whatsappVerified: true }, { whatsappOptedOut: false }, { companyId: COMPANY }]) {
      expect(createTenantBodySchema.safeParse({ ...minimal, ...extra }).success).toBe(false)
      expect(updateTenantBodySchema.safeParse(extra).success).toBe(false)
    }
  })

  it('needs at least one change, clears optional fields with empty or null, and lower-cases emails', () => {
    expect(updateTenantBodySchema.safeParse({}).success).toBe(false)
    expect(updateTenantBodySchema.safeParse({ primaryContact: {} }).success).toBe(false)
    expect(updateTenantBodySchema.parse({ email: '', vatNumber: null, primaryContact: { email: 'Ayanda@UbuntuCoffee.co.za' } })).toEqual({
      email: null,
      vatNumber: null,
      primaryContact: { email: 'ayanda@ubuntucoffee.co.za' },
    })
  })
})

describe('TenantsService writes', () => {
  const service = new TenantsService()

  it('creates a tenant in the active company with the defaults filled in', async () => {
    const { client, queries } = fakeDb(() => ({ data: { ...tenantRow, whatsapp_verified: false }, error: null }))
    const tenant = await service.create(client, COMPANY, createTenantBodySchema.parse(minimal))

    expect(tenant.whatsappVerified).toBe(false)
    const [q] = queries
    expect(q?.table).toBe('tenants')
    expect(callsTo(q!, 'insert')).toEqual([
      [
        {
          company_id: COMPANY,
          legal_name: 'Soweto Shoes (Pty) Ltd',
          trading_name: 'Soweto Shoes (Pty) Ltd',
          business_type: 'pty_ltd',
          registration_number: null,
          account_reference: null,
          vat_number: null,
          contact_full_name: 'Sizwe Mabena',
          contact_role: '',
          contact_phone: '+27825550199',
          contact_email: null,
          whatsapp_number: '+27825550199',
          email: null,
          status: 'prospective',
          industry: '',
          notes: null,
        },
      ],
    ])
    // The insert never carries the validation flag: the column grant refuses it and the default is unvalidated.
    expect(Object.keys(callsTo(q!, 'insert')[0]![0] as object)).not.toContain('whatsapp_verified')
  })

  it('changes only the fields sent, scoped to the company', async () => {
    const { client, queries } = fakeDb(() => ({ data: { ...tenantRow, whatsapp_number: '+27825550111', whatsapp_verified: false }, error: null }))
    const tenant = await service.update(
      client,
      COMPANY,
      tenantRow.id,
      updateTenantBodySchema.parse({ whatsappNumber: '082 555 0111', primaryContact: { role: 'Director' }, notes: '' }),
    )

    expect(tenant).toMatchObject({ whatsappNumber: '+27825550111', whatsappVerified: false })
    const [q] = queries
    expect(callsTo(q!, 'update')).toEqual([[{ whatsapp_number: '+27825550111', contact_role: 'Director', notes: null }]])
    expect(callsTo(q!, 'eq')).toEqual([
      ['company_id', COMPANY],
      ['id', tenantRow.id],
    ])
  })

  it('answers 404 when the tenant is not in the company and 403 when the database refuses the write', async () => {
    const missing = fakeDb(() => ({ data: null, error: null }))
    await expect(service.update(missing.client, COMPANY, tenantRow.id, updateTenantBodySchema.parse({ notes: 'x' }))).rejects.toBeInstanceOf(
      NotFoundException,
    )
    const refused = fakeDb(() => ({ data: null, error: { code: '42501', message: 'permission denied for table tenants' } }))
    await expect(service.create(refused.client, COMPANY, createTenantBodySchema.parse(minimal))).rejects.toBeInstanceOf(ForbiddenException)
  })
})
