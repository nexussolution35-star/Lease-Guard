import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'

import { callsTo, fakeDb, rpcArgs } from '../../common/testing/fake-db.test-helpers'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import { validateTenantWhatsAppBodySchema } from './tenants.schemas'
import { NUMBER_CHANGED_MESSAGE, TenantsService } from './tenants.service'
import { COMPANY, tenantRow } from './tenants.test-helpers'

const service = new TenantsService()
const body = validateTenantWhatsAppBodySchema.parse({ whatsappNumber: '082 555 0101' })

/** The database function answers `outcome`; reading the tenant back answers the stored row. */
function dbAnswering(outcome: string) {
  return fakeDb((query) => (query.table.startsWith('rpc:') ? { data: [{ outcome }], error: null } : { data: tenantRow, error: null }))
}

describe('validating a tenant WhatsApp number', () => {
  it('validates the number the person checked, in E.164, and returns the tenant with who validated it', async () => {
    const { client, queries } = dbAnswering('validated')
    const tenant = await service.validateWhatsApp(client, COMPANY, tenantRow.id, body)

    expect(tenant).toMatchObject({ id: tenantRow.id, whatsappVerified: true, whatsappValidatedByUserId: tenantRow.whatsapp_validated_by_user_id })
    const [rpc, read] = queries
    expect(rpc?.table).toBe('rpc:validate_tenant_whatsapp_number')
    expect(rpcArgs(rpc!)).toEqual({ p_company_id: COMPANY, p_tenant_id: tenantRow.id, p_whatsapp_number: '+27825550101' })
    expect(read?.table).toBe('tenants')
    expect(callsTo(read!, 'eq')).toEqual([
      ['company_id', COMPANY],
      ['id', tenantRow.id],
    ])
  })

  it('returns the tenant unchanged when the number is already validated', async () => {
    await expect(service.validateWhatsApp(dbAnswering('already_validated').client, COMPANY, tenantRow.id, body)).resolves.toMatchObject({
      whatsappVerified: true,
    })
  })

  it('answers 409 when the number changed since it was checked, and 404 for a tenant not in the company', async () => {
    const changed = service.validateWhatsApp(dbAnswering('number_changed').client, COMPANY, tenantRow.id, body)
    await expect(changed).rejects.toBeInstanceOf(ConflictException)
    await expect(changed).rejects.toThrow(NUMBER_CHANGED_MESSAGE)
    await expect(service.validateWhatsApp(dbAnswering('not_found').client, COMPANY, tenantRow.id, body)).rejects.toBeInstanceOf(NotFoundException)
  })

  it('answers 403 when the database refuses the caller', async () => {
    const refused = fakeDb(() => ({ data: null, error: { code: '42501', message: 'Only company admins and property managers can validate WhatsApp numbers' } }))
    await expect(service.validateWhatsApp(refused.client, COMPANY, tenantRow.id, body)).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('fails loudly on an outcome it does not know', async () => {
    await expect(service.validateWhatsApp(dbAnswering('surprise').client, COMPANY, tenantRow.id, body)).rejects.toThrow(/surprise/)
  })

  it('refuses a body without a valid number, or with other fields', () => {
    const pipe = new ZodValidationPipe(validateTenantWhatsAppBodySchema)
    expect(() => pipe.transform({ whatsappNumber: '123' })).toThrow(BadRequestException)
    expect(() => pipe.transform({})).toThrow(BadRequestException)
    expect(() => pipe.transform({ whatsappNumber: '+27825550101', whatsappVerified: true })).toThrow(BadRequestException)
  })
})
