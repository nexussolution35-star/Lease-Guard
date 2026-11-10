import { ForbiddenException, UnprocessableEntityException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'

import { callsTo, fakeDb, rpcArgs } from '../../common/testing/fake-db.test-helpers'
import { saveAgentConfigBodySchema, type SaveAgentConfigBody } from './whatsapp-agent.schemas'
import { WhatsAppAgentService } from './whatsapp-agent.service'

const COMPANY = '6f1d2c1e-0000-4000-8000-000000000001'
const ADMIN = '6f1d2c1e-0000-4000-8000-0000000000a1'
const MANAGER = '6f1d2c1e-0000-4000-8000-0000000000a2'

const row = {
  company_id: COMPANY,
  agent_name: 'Atlas assistant',
  business_description: 'Atlas Properties lets retail space.',
  tone: 'Warm',
  timezone: 'Africa/Johannesburg',
  operating_hours: [{ day: 'monday', opens: '08:00', closes: '17:00' }],
  languages: ['en', 'af'],
  policies: '',
  support_instructions: '',
  escalation_rules: 'Complaints go to a person.',
  permitted_actions: ['answer_faq'],
  auto_reply_enabled: true,
  out_of_hours_message: 'We are closed.',
  updated_by_user_id: ADMIN,
  created_at: '2026-11-10T08:00:00+00:00',
  updated_at: '2026-11-11T08:00:00+00:00',
}

const body: SaveAgentConfigBody = {
  agentName: 'Atlas assistant',
  businessDescription: 'Atlas Properties lets retail space.',
  tone: 'Warm',
  timezone: 'Africa/Johannesburg',
  operatingHours: [{ day: 'monday', opens: '08:00', closes: '17:00' }],
  languages: ['en', 'af', 'en'],
  policies: '',
  supportInstructions: '',
  escalationRules: 'Complaints go to a person.',
  permittedActions: ['answer_faq', 'answer_faq'],
  autoReplyEnabled: true,
  outOfHoursMessage: '',
  handoverContactUserIds: [MANAGER, MANAGER],
}

const service = new WhatsAppAgentService()

describe('WhatsAppAgentService.getConfig', () => {
  it('returns the defaults, auto-reply off and nothing permitted, until an admin saves a configuration', async () => {
    const db = fakeDb((q) => ({ data: q.table === 'whatsapp_agent_configs' ? null : [], error: null }))
    await expect(service.getConfig(db.client, COMPANY)).resolves.toEqual({
      companyId: COMPANY,
      configured: false,
      agentName: '',
      businessDescription: '',
      tone: '',
      timezone: 'Africa/Johannesburg',
      operatingHours: [],
      languages: ['en'],
      policies: '',
      supportInstructions: '',
      escalationRules: '',
      permittedActions: [],
      autoReplyEnabled: false,
      handoverContacts: [],
    })
    for (const q of db.queries) expect(callsTo(q, 'eq')).toEqual([['company_id', COMPANY]])
  })

  it("returns the company's configuration with its handover contacts' names", async () => {
    const db = fakeDb((q) => {
      if (q.table === 'whatsapp_agent_configs') return { data: row, error: null }
      if (q.table === 'whatsapp_agent_handover_contacts') return { data: [{ user_id: MANAGER }], error: null }
      return { data: [{ id: MANAGER, full_name: 'Naledi van der Merwe' }], error: null }
    })
    const config = await service.getConfig(db.client, COMPANY)
    expect(config).toMatchObject({
      configured: true,
      agentName: 'Atlas assistant',
      operatingHours: [{ day: 'monday', opens: '08:00', closes: '17:00' }],
      languages: ['en', 'af'],
      permittedActions: ['answer_faq'],
      autoReplyEnabled: true,
      outOfHoursMessage: 'We are closed.',
      handoverContacts: [{ userId: MANAGER, name: 'Naledi van der Merwe' }],
      updatedByUserId: ADMIN,
    })
  })
})

describe('WhatsAppAgentService.saveConfig', () => {
  it('saves the whole configuration in one database call, as snake_case columns, without duplicates', async () => {
    const db = fakeDb((q) => {
      if (q.table === 'rpc:save_whatsapp_agent_config') return { data: row, error: null }
      if (q.table === 'whatsapp_agent_configs') return { data: row, error: null }
      return { data: [], error: null }
    })
    await service.saveConfig(db.client, COMPANY, body)
    const call = db.queries.find((q) => q.table === 'rpc:save_whatsapp_agent_config')!
    expect(rpcArgs(call)).toEqual({
      p_company_id: COMPANY,
      p_config: {
        agent_name: 'Atlas assistant',
        business_description: 'Atlas Properties lets retail space.',
        tone: 'Warm',
        timezone: 'Africa/Johannesburg',
        operating_hours: [{ day: 'monday', opens: '08:00', closes: '17:00' }],
        languages: ['en', 'af'],
        policies: '',
        support_instructions: '',
        escalation_rules: 'Complaints go to a person.',
        permitted_actions: ['answer_faq'],
        auto_reply_enabled: true,
        out_of_hours_message: null,
      },
      p_handover_user_ids: [MANAGER],
    })
  })

  it('answers 422 when a handover contact cannot handle conversations, and 403 for a non-admin', async () => {
    const invalid = fakeDb(() => ({ data: null, error: { code: '22023', message: 'handover contacts must be…' } }))
    await expect(service.saveConfig(invalid.client, COMPANY, body)).rejects.toBeInstanceOf(UnprocessableEntityException)
    const denied = fakeDb(() => ({ data: null, error: { code: '42501', message: 'only company admins' } }))
    await expect(service.saveConfig(denied.client, COMPANY, body)).rejects.toBeInstanceOf(ForbiddenException)
  })
})

describe('saveAgentConfigBodySchema', () => {
  const valid = { ...body, languages: ['en'], permittedActions: ['answer_faq'], handoverContactUserIds: [MANAGER] }

  it('accepts a complete configuration', () => {
    expect(saveAgentConfigBodySchema.safeParse(valid).success).toBe(true)
  })

  it('refuses overlapping or inverted hours, unknown actions and languages, an unknown time zone and a blank name', () => {
    const issues = (value: unknown) => (saveAgentConfigBodySchema.safeParse(value).error?.issues ?? []).map((issue) => issue.message)
    expect(issues({ ...valid, operatingHours: [{ day: 'monday', opens: '17:00', closes: '08:00' }] })).toEqual(['Monday: closing time must be after opening time'])
    expect(
      issues({
        ...valid,
        operatingHours: [
          { day: 'monday', opens: '08:00', closes: '13:00' },
          { day: 'monday', opens: '12:00', closes: '17:00' },
        ],
      }),
    ).toEqual(['Monday: opening periods overlap'])
    expect(saveAgentConfigBodySchema.safeParse({ ...valid, permittedActions: ['send_tenant_message'] }).success).toBe(false)
    expect(saveAgentConfigBodySchema.safeParse({ ...valid, languages: ['fr'] }).success).toBe(false)
    expect(saveAgentConfigBodySchema.safeParse({ ...valid, languages: [] }).success).toBe(false)
    expect(issues({ ...valid, timezone: 'Mars/Olympus' })).toEqual(['Use a time zone such as Africa/Johannesburg'])
    expect(issues({ ...valid, agentName: '   ' })).toEqual(['Give the agent a name'])
    expect(saveAgentConfigBodySchema.safeParse({ ...valid, extra: true }).success).toBe(false)
  })
})
