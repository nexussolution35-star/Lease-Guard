import { ServiceUnavailableException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'

import { tableDb } from '../../common/testing/table-db.test-helpers'
import { WhatsAppIntegrationService } from './whatsapp-integration.service'

const COMPANY = '6f1d2c1e-0000-4000-8000-000000000001'
const OTHER = '6f1d2c1e-0000-4000-8000-000000000002'

const account = (id: string, companyId: string, businessAccountId: string, createdAt: string, name: string | null = null) => ({
  id,
  company_id: companyId,
  business_account_id: businessAccountId,
  name,
  created_at: createdAt,
  updated_at: createdAt,
})

const number = (id: string, companyId: string, businessAccountId: string, phoneNumberId: string, createdAt: string, extra: Record<string, unknown> = {}) => ({
  id,
  company_id: companyId,
  business_account_id: businessAccountId,
  phone_number_id: phoneNumberId,
  display_name: `Number ${phoneNumberId}`,
  display_number: '+27 11 555 0100',
  verified_name: null,
  quality_rating: null,
  code_verification_status: null,
  name_status: null,
  meta_status: null,
  // The service role's view of the row; the service must never pass it on.
  access_token_reference: 'secret://vault/3f0c1a52-8d4e-4b7a-9c61-2e5d7f9a0b13',
  webhook_configured: false,
  connection_status: 'pending_verification',
  last_verified_at: null,
  created_at: createdAt,
  updated_at: createdAt,
  ...extra,
})

const tables = {
  whatsapp_business_accounts: [
    account('acc-2', COMPANY, '2002', '2026-11-02T08:00:00Z'),
    account('acc-1', COMPANY, '1001', '2026-11-01T08:00:00Z', 'Nexus Leasing'),
    account('acc-x', OTHER, '9009', '2026-10-01T08:00:00Z', 'Other company'),
  ],
  whatsapp_phone_numbers: [
    number('num-b', COMPANY, '1001', '111222', '2026-11-03T08:00:00Z', { operator_imported_at: '2026-11-03T07:30:00Z' }),
    number('num-a', COMPANY, '1001', '111111', '2026-11-01T09:00:00Z', {
      verified_name: 'Nexus Leasing',
      quality_rating: 'GREEN',
      code_verification_status: 'VERIFIED',
      name_status: 'APPROVED',
      meta_status: 'CONNECTED',
      webhook_configured: true,
      connection_status: 'connected',
      last_verified_at: '2026-11-04T10:00:00Z',
    }),
    number('num-x', OTHER, '9009', '999999', '2026-10-01T09:00:00Z', { connection_status: 'connected' }),
    number('num-gone', COMPANY, '2002', '222333', '2026-11-02T09:00:00Z', {
      connection_status: 'disconnected',
      disconnected_at: '2026-11-09T07:00:00Z',
      disconnected_reason: 'The business removed LeaseGuard from this WhatsApp Business Account in Meta.',
      messaging_limit_tier: 'TIER_1K',
      messaging_limit_updated_at: '2026-11-08T07:00:00Z',
    }),
  ],
  whatsapp_number_verification_steps: [
    step('num-b', COMPANY, 'registration', 'action_needed', { recovery: 'Click Register number' }),
    step('num-b', COMPANY, 'token_scopes', 'passed'),
    step('num-x', OTHER, 'token_scopes', 'failed'),
  ],
}

function step(numberId: string, companyId: string, name: string, status: string, extra: Record<string, unknown> = {}) {
  return {
    id: `${numberId}-${name}`,
    company_id: companyId,
    number_id: numberId,
    step: name,
    status,
    message: `${name} ${status}`,
    recovery: null,
    meta_error_code: null,
    checked_at: '2026-11-05T08:00:00Z',
    ...extra,
  }
}

describe('WhatsAppIntegrationService.listBusinessAccounts', () => {
  const service = new WhatsAppIntegrationService()

  it("lists the company's business accounts, oldest first, each with its own numbers, and nothing of another company", async () => {
    const accounts = await service.listBusinessAccounts(tableDb(tables), COMPANY)

    expect(accounts.map((a) => [a.businessAccountId, a.numbers.map((n) => n.phoneNumberId)])).toEqual([
      ['1001', ['111111', '111222']],
      ['2002', ['222333']],
    ])
    expect(JSON.stringify(accounts)).not.toMatch(/9009|999999|Other company/)
  })

  it('says when and why Meta disconnected a number, and its messaging limit', async () => {
    const accounts = await service.listBusinessAccounts(tableDb(tables), COMPANY)
    expect(accounts[1]?.numbers[0]).toMatchObject({
      connectionStatus: 'disconnected',
      disconnectedAt: '2026-11-09T07:00:00Z',
      disconnectedReason: 'The business removed LeaseGuard from this WhatsApp Business Account in Meta.',
      messagingLimitTier: 'TIER_1K',
    })
  })

  it('says when Nexus Solution connected a number with the number import', async () => {
    const [first] = await service.listBusinessAccounts(tableDb(tables), COMPANY)
    expect(first?.numbers.map((n) => [n.id, n.operatorImportedAt])).toEqual([
      ['num-a', undefined],
      ['num-b', '2026-11-03T07:30:00Z'],
    ])
  })

  it("maps Meta's status of a number and omits what Meta has not reported", async () => {
    const [first] = await service.listBusinessAccounts(tableDb(tables), COMPANY)

    expect(first).toMatchObject({ id: 'acc-1', name: 'Nexus Leasing', createdAt: '2026-11-01T08:00:00Z' })
    expect(first?.numbers[0]).toEqual({
      id: 'num-a',
      businessAccountId: '1001',
      phoneNumberId: '111111',
      displayName: 'Number 111111',
      displayNumber: '+27 11 555 0100',
      verifiedName: 'Nexus Leasing',
      qualityRating: 'GREEN',
      codeVerificationStatus: 'VERIFIED',
      nameStatus: 'APPROVED',
      metaStatus: 'CONNECTED',
      webhookConfigured: true,
      connectionStatus: 'connected',
      lastVerifiedAt: '2026-11-04T10:00:00Z',
      verificationSteps: [],
      createdAt: '2026-11-01T09:00:00Z',
    })
    expect(first?.numbers[1]).toEqual({
      id: 'num-b',
      businessAccountId: '1001',
      phoneNumberId: '111222',
      displayName: 'Number 111222',
      displayNumber: '+27 11 555 0100',
      webhookConfigured: false,
      connectionStatus: 'pending_verification',
      operatorImportedAt: '2026-11-03T07:30:00Z',
      verificationSteps: [
        { step: 'token_scopes', status: 'passed', message: 'token_scopes passed', checkedAt: '2026-11-05T08:00:00Z' },
        {
          step: 'registration',
          status: 'action_needed',
          message: 'registration action_needed',
          recovery: 'Click Register number',
          checkedAt: '2026-11-05T08:00:00Z',
        },
      ],
      createdAt: '2026-11-03T08:00:00Z',
    })
  })

  it('never returns the credential reference', async () => {
    const accounts = await service.listBusinessAccounts(tableDb(tables), COMPANY)
    expect(JSON.stringify(accounts)).not.toMatch(/secret:|accessToken/i)
  })

  it('is empty for a company without WhatsApp', async () => {
    await expect(service.listBusinessAccounts(tableDb({}), COMPANY)).resolves.toEqual([])
  })

  it('maps an unavailable database to 503', async () => {
    const down = tableDb(tables, { whatsapp_phone_numbers: { code: 'PGRST000', message: 'connection refused' } })
    await expect(service.listBusinessAccounts(down, COMPANY)).rejects.toBeInstanceOf(ServiceUnavailableException)
  })
})
