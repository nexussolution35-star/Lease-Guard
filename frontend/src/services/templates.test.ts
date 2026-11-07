import { beforeEach, describe, expect, it } from 'vitest'

import { createDemoSeed, DEMO_COMPANY_IDS, TEMPLATE_IDS, TENANT_IDS } from '@/services/demo/seed'
import { containsBankDetails, findForbiddenTenantTopics } from '@leaseguard/domain'
import { useAppStore } from '@/store/appStore'

import { BankDetailsInMessageError, draftTenantMessage, getTemplate, templatesRepo } from '@/services/communications'
import {
  createMessageTemplate,
  deleteMessageTemplate,
  recordTemplateDecision,
  renderTemplate,
  submitTemplateForApproval,
  TemplateValidationError,
  updateMessageTemplate,
  validateTemplateBody,
} from '@/services/templates'

beforeEach(() => {
  localStorage.clear()
  useAppStore.getState().resetDemoData()
})

const BASE = {
  name: 'Gentle reminder',
  messageType: 'initial_payment_reminder' as const,
  audience: 'tenant' as const,
  metaTemplateName: 'gentle_reminder',
  language: 'en_ZA' as const,
  category: 'utility' as const,
  body: 'Hi {{1}}, your balance is {{2}}.',
  variables: ['tenant first name', 'balance'],
  supportsDocumentAttachment: false,
}

describe('seed templates and messages', () => {
  it('contain no bank details, and tenant ones no forbidden topics', () => {
    const seed = createDemoSeed()
    for (const t of Object.values(seed.messageTemplates)) {
      expect(containsBankDetails(t.body), t.id).toBe(false)
      if (t.audience === 'tenant') expect(findForbiddenTenantTopics(t.body), t.id).toEqual([])
      expect(validateTemplateBody(t.body, t.audience).valid, t.id).toBe(true)
    }
    for (const c of Object.values(seed.communications)) {
      expect(containsBankDetails(c.body), c.id).toBe(false)
      if (c.recipientType === 'tenant' && c.direction === 'outbound') expect(findForbiddenTenantTopics(c.body), c.id).toEqual([])
    }
  })
})

describe('template CRUD', () => {
  it('creates a validated draft template in the active company with an audit row', () => {
    const t = createMessageTemplate(BASE)
    expect(t.approvalStatus).toBe('draft')
    expect(t.companyId).toBe(DEMO_COMPANY_IDS.nexus)
    expect(Object.values(useAppStore.getState().collections.auditLogs).some((l) => l.entityId === t.id)).toBe(true)
  })

  it('rejects bank details, forbidden tenant topics, wrong types and mismatched variables', () => {
    expect(() => createMessageTemplate({ ...BASE, body: 'Pay into account number {{1}}', variables: ['x'] })).toThrow(TemplateValidationError)
    expect(() => createMessageTemplate({ ...BASE, body: 'Hi {{1}}, your lease expires on {{2}}' })).toThrow(/may not mention/)
    expect(() => createMessageTemplate({ ...BASE, messageType: 'owner_weekly_summary' })).toThrow(/tenant templates/)
    expect(() => createMessageTemplate({ ...BASE, variables: ['only one'] })).toThrow(/placeholder/)
    expect(createMessageTemplate({ ...BASE, audience: 'property_owner', messageType: 'owner_query_response', body: 'Lease expiry for {{1}} on {{2}}' }).audience).toBe('property_owner')
  })

  it('editing the body of an approved template returns it to draft; submit/decide flow', () => {
    const id = TEMPLATE_IDS.nexus.initialReminder
    const updated = updateMessageTemplate(id, { body: 'Hi {{1}}, balance {{2}} due {{3}} on {{4}}.' })
    expect(updated.approvalStatus).toBe('draft')
    expect(submitTemplateForApproval(id).approvalStatus).toBe('submitted')
    expect(() => submitTemplateForApproval(id)).toThrow(/cannot be submitted/)
    expect(recordTemplateDecision(id, 'approved').approvalStatus).toBe('approved')
    expect(() => updateMessageTemplate(id, { body: 'Branch code 250655' })).toThrow(TemplateValidationError)
  })

  it('deletes templates of the active company only', () => {
    const t = createMessageTemplate(BASE)
    deleteMessageTemplate(t.id)
    expect(templatesRepo.getById(t.id)).toBeUndefined()
    expect(() => deleteMessageTemplate(TEMPLATE_IDS.kgalagadi.monthlyStatement)).toThrow(/not found/)
  })
})

describe('renderTemplate', () => {
  it('fills placeholders by number or variable name', () => {
    const tpl = getTemplate(TEMPLATE_IDS.nexus.installmentReminder)
    if (!tpl) throw new Error('missing template')
    const out = renderTemplate(tpl, { '1': 'Mandla', [tpl.variables[1]]: 'R 6 200,00', '3': '15 Nov 2026' })
    expect(out).toContain('Hi Mandla')
    expect(out).toContain('R 6 200,00')
    expect(out).not.toMatch(/\{\{/)
  })

  it('errors on missing variables and on variables that inject bank details', () => {
    expect(() => renderTemplate(BASE, { '1': 'Rose' })).toThrow(/\{\{2\}\}/)
    expect(() => renderTemplate(BASE, { '1': 'Rose', '2': 'R10 — account number 62012345678' })).toThrow(TemplateValidationError)
  })
})

describe('draftTenantMessage bank-detail guard', () => {
  it('rejects bodies containing bank details', () => {
    expect(() =>
      draftTenantMessage('initial_payment_reminder', TENANT_IDS.thriftyFoods, 'Please pay into account 62012345678, branch code 250655'),
    ).toThrow(BankDetailsInMessageError)
  })
})
