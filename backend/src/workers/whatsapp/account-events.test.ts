import { describe, expect, it } from 'vitest'

import {
  type AccessRemoval,
  accountEvents,
  type AccountEventStore,
  type QualityUpdate,
  type TemplateStatusChange,
} from './account-events'

const ATLAS = 'company-atlas'
const AT = new Date('2026-11-10T08:00:00Z')

function harness(options: { appId?: string; holders?: string[] } = {}) {
  const holders = options.holders ?? [ATLAS]
  const removals: { businessAccountId: string; event: string; occurredAt: Date | null }[] = []
  const templates: { businessAccountId: string; change: TemplateStatusChange; occurredAt: Date | null }[] = []
  const quality: { businessAccountId: string; update: QualityUpdate; occurredAt: Date | null }[] = []
  const store: AccountEventStore = {
    async removeAccess(businessAccountId, event, occurredAt): Promise<AccessRemoval[]> {
      removals.push({ businessAccountId, event, occurredAt })
      return holders.map((companyId) => ({ companyId, numbersDisconnected: 1, tokenRemoved: true, adminsNotified: 2 }))
    },
    async applyTemplateStatus(businessAccountId, change, occurredAt) {
      templates.push({ businessAccountId, change, occurredAt })
      return holders.map((companyId) => ({ companyId, outcome: 'updated' as const }))
    },
    async refreshNumberQuality(businessAccountId, update, occurredAt) {
      quality.push({ businessAccountId, update, occurredAt })
      return holders.map((companyId) => ({ companyId, outcome: 'refreshed' as const, numbers: 1 }))
    },
  }
  const events = accountEvents({ store, appId: options.appId })
  const route = (field: string, value: unknown, businessAccountId: string | null = '771001') =>
    events.route(field, { businessAccountId, occurredAt: AT, value })
  return { route, removals, templates, quality }
}

describe('account events', () => {
  it('disconnects the account when the business removes LeaseGuard in Meta, and reports each company it applied to', async () => {
    const { route, removals } = harness({ appId: '1234' })
    const outcomes = await route('account_update', {
      event: 'PARTNER_APP_UNINSTALLED',
      waba_info: { waba_id: '771001', owner_business_id: '55', partner_app_id: '1234' },
    })
    expect(removals).toEqual([{ businessAccountId: '771001', event: 'PARTNER_APP_UNINSTALLED', occurredAt: AT }])
    expect(outcomes).toEqual([
      {
        field: 'account_update',
        businessAccountId: '771001',
        event: 'PARTNER_APP_UNINSTALLED',
        companyId: ATLAS,
        outcome: 'disconnected',
        numbersDisconnected: 1,
        tokenRemoved: true,
        adminsNotified: 2,
      },
    ])
  })

  it('takes the account from waba_info over the entry, and records an account no company holds', async () => {
    const { route, removals } = harness({ holders: [] })
    const outcomes = await route('account_update', { event: 'PARTNER_REMOVED', waba_info: { waba_id: '771009' } }, '771001')
    expect(removals[0]?.businessAccountId).toBe('771009')
    expect(outcomes).toEqual([{ field: 'account_update', businessAccountId: '771009', event: 'PARTNER_REMOVED', outcome: 'no_holder' }])
  })

  it("ignores another app's uninstall", async () => {
    const { route, removals } = harness({ appId: '1234' })
    const outcomes = await route('account_update', { event: 'PARTNER_APP_UNINSTALLED', waba_info: { waba_id: '771001', partner_app_id: '9999' } })
    expect(removals).toEqual([])
    expect(outcomes).toEqual([{ field: 'account_update', businessAccountId: '771001', event: 'PARTNER_APP_UNINSTALLED', outcome: 'other_app' }])
  })

  it('records account events that do not end access without acting on them', async () => {
    const { route, removals } = harness()
    const outcomes = await route('account_update', { event: 'ACCOUNT_RESTRICTION' })
    expect(removals).toEqual([])
    expect(outcomes).toEqual([{ field: 'account_update', businessAccountId: '771001', event: 'ACCOUNT_RESTRICTION', outcome: 'not_handled' }])
  })

  it("applies a template's new status, with Meta's id, name, language, category and reason", async () => {
    const { route, templates } = harness()
    const outcomes = await route('message_template_status_update', {
      event: 'REJECTED',
      message_template_id: 1001,
      message_template_name: 'monthly_statement_v1',
      message_template_language: 'en',
      message_template_category: 'UTILITY',
      reason: 'INVALID_FORMAT',
    })
    expect(templates).toEqual([
      {
        businessAccountId: '771001',
        occurredAt: AT,
        change: { metaTemplateId: '1001', name: 'monthly_statement_v1', language: 'en', category: 'UTILITY', status: 'REJECTED', reason: 'INVALID_FORMAT' },
      },
    ])
    expect(outcomes).toEqual([
      { field: 'message_template_status_update', businessAccountId: '771001', templateId: '1001', status: 'REJECTED', companyId: ATLAS, outcome: 'updated' },
    ])
  })

  it('treats a reinstated template as approved', async () => {
    const { route, templates } = harness()
    await route('message_template_status_update', { event: 'REINSTATED', message_template_id: '1001' })
    expect(templates[0]?.change).toEqual({ metaTemplateId: '1001', name: null, language: null, category: null, status: 'APPROVED', reason: null })
  })

  it.each(['UNARCHIVED', 'LOCKED', 'SOMETHING_NEW'])('records the %s event, which names no status, without changing the template', async (event) => {
    // Passing it on as a status would store it and map it to rejected, so the outbound gate would stop a sendable template.
    const { route, templates } = harness()
    const outcomes = await route('message_template_status_update', { event, message_template_id: '1001', message_template_name: 'monthly_statement_v1' })
    expect(templates).toEqual([])
    expect(outcomes).toEqual([{ field: 'message_template_status_update', businessAccountId: '771001', templateId: '1001', event, outcome: 'not_handled' }])
  })

  it.each(['APPROVED', 'REJECTED', 'PENDING', 'PAUSED', 'DISABLED', 'FLAGGED', 'IN_APPEAL', 'LIMIT_EXCEEDED', 'ARCHIVED', 'DELETED', 'PENDING_DELETION'])(
    'applies the %s event as that status',
    async (event) => {
      const { route, templates } = harness()
      await route('message_template_status_update', { event: event.toLowerCase(), message_template_id: '1001' })
      expect(templates[0]?.change.status).toBe(event)
    },
  )

  it('refuses a template status without a Meta template id', async () => {
    const { route, templates } = harness()
    const outcomes = await route('message_template_status_update', { event: 'APPROVED' })
    expect(templates).toEqual([])
    expect(outcomes).toEqual([{ field: 'message_template_status_update', outcome: 'invalid', reason: 'template status without a template id' }])
  })

  it("refreshes Meta's view of the account's numbers on a quality update, with the messaging limit", async () => {
    const { route, quality } = harness()
    const outcomes = await route('phone_number_quality_update', {
      display_phone_number: '+27 11 555 0101',
      event: 'THROUGHPUT_UPGRADE',
      max_daily_conversations_per_business: 'TIER_10K',
    })
    expect(quality).toEqual([
      { businessAccountId: '771001', occurredAt: AT, update: { displayPhoneNumber: '27115550101', event: 'THROUGHPUT_UPGRADE', messagingLimitTier: 'TIER_10K' } },
    ])
    expect(outcomes).toEqual([
      { field: 'phone_number_quality_update', businessAccountId: '771001', event: 'THROUGHPUT_UPGRADE', companyId: ATLAS, outcome: 'refreshed', numbers: 1 },
    ])
  })

  it("accepts Meta's older current_limit field", async () => {
    const { route, quality } = harness()
    await route('phone_number_quality_update', { display_phone_number: '27115550101', event: 'DOWNGRADE', current_limit: 'TIER_1K' })
    expect(quality[0]?.update.messagingLimitTier).toBe('TIER_1K')
  })

  it('refuses an account event without a WhatsApp Business Account', async () => {
    const { route, removals } = harness()
    const outcomes = await route('account_update', { event: 'PARTNER_APP_UNINSTALLED' }, null)
    expect(removals).toEqual([])
    expect(outcomes).toEqual([{ field: 'account_update', outcome: 'invalid', reason: 'account event without a WhatsApp Business Account' }])
  })

  it('leaves fields it does not handle to the caller', async () => {
    const { route } = harness()
    await expect(route('calls', {})).resolves.toBeNull()
  })
})
