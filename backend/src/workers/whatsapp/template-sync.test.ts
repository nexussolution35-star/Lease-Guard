import type { EntityId } from '@leaseguard/domain'
import { describe, expect, it } from 'vitest'

import { FakeWhatsAppChannels } from '../../infrastructure/whatsapp/fake-whatsapp-channels.test-helpers'
import { type MetaMessageTemplate, type NumberManagement, WhatsAppApiError } from '../../infrastructure/whatsapp/whatsapp-channels'
import { syncNumberTemplates } from './template-sync'

const COMPANY = '20000000-0000-4000-8000-000000000001'
const NUMBER = '50000000-0000-4000-8000-000000000001'
const ACCOUNT = '771001'
const TEMPLATES: MetaMessageTemplate[] = [
  { id: '9001', name: 'monthly_statement', language: 'en_ZA', category: 'UTILITY', status: 'APPROVED', body: 'Good day {{1}}.', headerFormat: 'DOCUMENT' },
  { id: '9002', name: 'overdue_reminder', language: 'en_ZA', category: 'UTILITY', status: 'PENDING', body: 'Good day {{1}}.' },
]

function harness(options: { templates?: () => Promise<MetaMessageTemplate[]>; unavailable?: boolean } = {}) {
  const synced: { companyId: EntityId; businessAccountId: string; templates: readonly MetaMessageTemplate[] }[] = []
  const management = {
    available: true,
    businessAccountId: ACCOUNT,
    phoneNumberId: '660001',
    templates: options.templates ?? (async () => TEMPLATES),
  } as unknown as NumberManagement
  const channels = new FakeWhatsAppChannels({
    manageNumber: async (companyId, numberId) => {
      expect([companyId, numberId]).toEqual([COMPANY, NUMBER])
      return options.unavailable ? { available: false, reason: 'not_connected', message: 'The number is disconnected' } : management
    },
  })
  const store = {
    async syncTemplates(companyId: EntityId, businessAccountId: string, templates: readonly MetaMessageTemplate[]) {
      synced.push({ companyId, businessAccountId, templates })
      return templates.length
    },
  }
  const run = (finalAttempt = false) => syncNumberTemplates({ companyId: COMPANY, numberId: NUMBER }, { finalAttempt }, { channels, store })
  return { run, synced }
}

describe('syncNumberTemplates', () => {
  it("replaces the account's synced templates with Meta's, text and header format included", async () => {
    const h = harness()
    await expect(h.run()).resolves.toEqual({ outcome: 'synced', businessAccountId: ACCOUNT, count: 2, approved: 1 })
    expect(h.synced).toEqual([{ companyId: COMPANY, businessAccountId: ACCOUNT, templates: TEMPLATES }])
  })

  it('skips a number the company can no longer manage', async () => {
    const h = harness({ unavailable: true })
    await expect(h.run()).resolves.toEqual({ outcome: 'skipped', reason: 'not_connected' })
    expect(h.synced).toEqual([])
  })

  it('retries when Meta is unreachable, and records the failure on the final attempt', async () => {
    const unreachable = new WhatsAppApiError('WhatsApp Graph API timed out', { retryable: true })
    const h = harness({ templates: () => Promise.reject(unreachable) })
    await expect(h.run()).rejects.toBe(unreachable)
    await expect(h.run(true)).resolves.toEqual({ outcome: 'failed', message: 'WhatsApp Graph API timed out' })
    expect(h.synced).toEqual([])
  })

  it("does not retry Meta's refusal", async () => {
    const refused = new WhatsAppApiError('WhatsApp Graph API returned HTTP 400 (code 200)', { retryable: false, status: 400, graphCode: 200 })
    const h = harness({ templates: () => Promise.reject(refused) })
    await expect(h.run()).resolves.toEqual({ outcome: 'failed', message: refused.message, metaErrorCode: 200 })
  })
})
