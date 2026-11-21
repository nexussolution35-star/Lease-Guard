import { describe, expect, it } from 'vitest'

import type { MappingCandidate, MessageTypeTemplateMapping } from '../types/index.js'
import { TEMPLATED_MESSAGE_TYPES } from '../types/index.js'
import {
  canMapTemplate,
  isTemplatedMessageType,
  messageTypeAudience,
  messageTypeTemplateState,
  messageTypeVariableNames,
  metaTemplateApproval,
  previewTemplateBody,
  sampleTemplateValues,
  templateInUseBy,
  templateMappingProblems,
} from './messageTemplates.js'

const statement: MappingCandidate = {
  name: 'monthly_statement_v2',
  language: 'en_ZA',
  category: 'UTILITY',
  status: 'APPROVED',
  body: 'Good day {{1}}. Your {{2}} statement is attached. Amount due: {{3}} by {{4}}.',
  headerFormat: 'DOCUMENT',
}

const mapping: MessageTypeTemplateMapping = {
  templateId: 't1',
  whatsappTemplateId: 'w1',
  metaTemplateName: 'monthly_statement_v2',
  language: 'en_ZA',
  category: 'utility',
  body: statement.body!,
  variables: ['Tenant name', 'Statement period', 'Amount due', 'Due date'],
  approvalStatus: 'approved',
  metaStatus: 'APPROVED',
  supportsDocumentAttachment: true,
  metaBodyChanged: false,
  mappedAt: '2026-11-21T10:00:00+02:00',
}

describe('templated message types', () => {
  it('lists the five tenant types first, then the owner types, and nothing untemplated', () => {
    expect(TEMPLATED_MESSAGE_TYPES).toEqual([
      'monthly_statement',
      'initial_payment_reminder',
      'overdue_payment_reminder',
      'follow_up_payment_reminder',
      'arrangement_installment_reminder',
      'owner_weekly_summary',
      'owner_query_response',
    ])
    expect(isTemplatedMessageType('manual')).toBe(false)
    expect(isTemplatedMessageType('inbound_reply')).toBe(false)
  })

  it('names the audience of each type', () => {
    expect(messageTypeAudience('overdue_payment_reminder')).toBe('tenant')
    expect(messageTypeAudience('owner_weekly_summary')).toBe('property_owner')
  })
})

describe('metaTemplateApproval', () => {
  it('matches the database mapping of Meta statuses', () => {
    expect(metaTemplateApproval('APPROVED')).toBe('approved')
    expect(metaTemplateApproval('flagged')).toBe('approved')
    expect(metaTemplateApproval('PENDING')).toBe('submitted')
    expect(metaTemplateApproval('IN_APPEAL')).toBe('submitted')
    expect(metaTemplateApproval('PAUSED')).toBe('rejected')
    expect(metaTemplateApproval('REJECTED')).toBe('rejected')
  })
})

describe('templateMappingProblems', () => {
  it('accepts an approved utility statement template', () => {
    expect(templateMappingProblems('monthly_statement', statement)).toEqual([])
    expect(canMapTemplate('monthly_statement', statement)).toBe(true)
  })

  it('refuses a template Meta has not approved', () => {
    expect(templateMappingProblems('monthly_statement', { ...statement, status: 'PENDING' })).toEqual([
      'Meta has not approved "monthly_statement_v2" (Pending). Only approved templates can be chosen.',
    ])
  })

  it('refuses a marketing template for a tenant type, but not for an owner type', () => {
    const marketing = { ...statement, category: 'MARKETING' }
    expect(templateMappingProblems('initial_payment_reminder', marketing)).toEqual([
      'A tenant message needs a Utility template for statement and payment messages; "monthly_statement_v2" is Marketing.',
    ])
    expect(templateMappingProblems('owner_weekly_summary', marketing)).toEqual([])
  })

  it('refuses an authentication template for any type', () => {
    expect(templateMappingProblems('owner_query_response', { ...statement, category: 'AUTHENTICATION' })).toHaveLength(1)
  })

  it('refuses a tenant template about a forbidden topic', () => {
    for (const body of [
      'Your rent escalates by 8% on {{1}}.',
      'Your lease expires on {{1}}.',
      'Your renewal option closes on {{1}}.',
      'Your dispute {{1}} is open.',
      'Your bank guarantee {{1}} lapses.',
    ]) {
      const problems = templateMappingProblems('overdue_payment_reminder', { ...statement, body })
      expect(problems.some((p) => p.startsWith('Tenant messages may not mention')), body).toBe(true)
    }
    // An owner may be told about them.
    expect(templateMappingProblems('owner_weekly_summary', { ...statement, body: 'Lease {{1}} expires on {{2}}.' })).toEqual([])
  })

  it('refuses bank details for every audience', () => {
    const body = 'Pay into account number 62012345678, branch code 250655. Ref {{1}}.'
    expect(templateMappingProblems('owner_weekly_summary', { ...statement, body }).some((p) => p.includes('banking details'))).toBe(true)
    expect(templateMappingProblems('monthly_statement', { ...statement, body }).some((p) => p.includes('banking details'))).toBe(true)
  })

  it('refuses a template without text, and one with named parameters or gaps', () => {
    expect(templateMappingProblems('monthly_statement', { ...statement, body: undefined })).toEqual([
      'LeaseGuard does not have the text of "monthly_statement_v2" yet. Sync the templates again, then choose it.',
    ])
    expect(templateMappingProblems('monthly_statement', { ...statement, body: 'Good day {{tenant_name}}.' })[0]).toContain('named parameters')
    expect(templateMappingProblems('monthly_statement', { ...statement, body: 'Good day {{1}}, {{3}}.' })[0]).toContain('without gaps')
  })
})

describe('variables and preview', () => {
  it('names each placeholder of a type, and numbers the ones it does not know', () => {
    expect(messageTypeVariableNames('overdue_payment_reminder', 4)).toEqual(['Tenant name', 'Amount overdue', 'Days overdue', 'Variable 4'])
    expect(messageTypeVariableNames('monthly_statement', 0)).toEqual([])
  })

  it('fills the preview with en-ZA rand and date samples', () => {
    expect(sampleTemplateValues('monthly_statement', 4)).toEqual({
      1: 'Sample Trading (Pty) Ltd',
      2: 'November 2026',
      3: 'R 12 450,00',
      4: '07 Dec 2026',
    })
    expect(previewTemplateBody('monthly_statement', statement.body!)).toBe(
      'Good day Sample Trading (Pty) Ltd. Your November 2026 statement is attached. Amount due: R 12 450,00 by 07 Dec 2026.',
    )
    expect(previewTemplateBody('owner_query_response', 'No placeholders.')).toBe('No placeholders.')
    expect(previewTemplateBody('owner_query_response', '{{1}} {{2}} {{3}}')).toBe('Sample Owner Your statement for November 2026 has been verified. Sample 3')
  })
})

describe('messageTypeTemplateState', () => {
  it('explains a type without a template', () => {
    expect(messageTypeTemplateState(undefined)).toMatchObject({ status: 'not_mapped', sendable: false })
  })

  it('sends with an approved template whose text is unchanged', () => {
    expect(messageTypeTemplateState(mapping)).toMatchObject({ status: 'ready', sendable: true })
    expect(messageTypeTemplateState({ ...mapping, metaStatus: 'FLAGGED' }).sendable).toBe(true)
  })

  it('waits for Meta while the template is in review', () => {
    expect(messageTypeTemplateState({ ...mapping, approvalStatus: 'submitted', metaStatus: 'PENDING' })).toMatchObject({
      status: 'waiting_on_meta',
      sendable: false,
    })
  })

  it('explains a rejected or paused template with Meta’s reason and what to do next', () => {
    const state = messageTypeTemplateState({ ...mapping, approvalStatus: 'rejected', metaStatus: 'REJECTED', rejectedReason: 'INVALID_FORMAT' })
    expect(state).toMatchObject({ status: 'rejected', sendable: false, summary: 'Rejected by Meta: Invalid format. Messages of this type cannot be sent.' })
    expect(state.nextStep).toContain('WhatsApp Manager')
    expect(messageTypeTemplateState({ ...mapping, approvalStatus: 'rejected', metaStatus: 'PAUSED' }).summary).toMatch(/^Paused by Meta/)
  })

  it('stops a template Meta no longer holds, or whose text changed', () => {
    expect(messageTypeTemplateState({ ...mapping, approvalStatus: 'draft', metaStatus: undefined, whatsappTemplateId: undefined }).status).toBe('removed')
    expect(messageTypeTemplateState({ ...mapping, metaBodyChanged: true })).toMatchObject({ status: 'text_changed', sendable: false })
  })
})

describe('templateInUseBy', () => {
  const types = [
    { messageType: 'monthly_statement' as const, audience: 'tenant' as const, mapping, sendable: true },
    { messageType: 'owner_weekly_summary' as const, audience: 'property_owner' as const, sendable: false },
  ]
  it('names the other type a template already sends, by Meta name and language', () => {
    expect(templateInUseBy(types, { name: 'monthly_statement_v2', language: 'en_ZA' }, 'initial_payment_reminder')).toBe('monthly_statement')
    expect(templateInUseBy(types, { name: 'monthly_statement_v2', language: 'en_ZA' }, 'monthly_statement')).toBeUndefined()
    expect(templateInUseBy(types, { name: 'monthly_statement_v2', language: 'af' }, 'initial_payment_reminder')).toBeUndefined()
  })
})
