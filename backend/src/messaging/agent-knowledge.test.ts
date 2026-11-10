import { describe, expect, it } from 'vitest'

import { fakeDb, rpcArgs } from '../common/testing/fake-db.test-helpers'
import { loadAgentKnowledge } from './agent-knowledge'
import { MessagingReadError } from './read-error'

const COMPANY = '6f1d2c1e-0000-4000-8000-000000000001'
const FAQ = '6f1d2c1e-0000-4000-8000-0000000000b1'

const knowledge = {
  companyId: COMPANY,
  config: {
    agentName: 'Atlas assistant',
    businessDescription: 'Atlas Properties lets retail space.',
    tone: '',
    timezone: 'Africa/Johannesburg',
    operatingHours: [{ day: 'monday', opens: '08:00', closes: '17:00' }],
    languages: ['en'],
    policies: '',
    supportInstructions: '',
    escalationRules: '',
    permittedActions: ['answer_faq'],
    autoReplyEnabled: true,
    outOfHoursMessage: null,
    updatedAt: '2026-11-11T08:00:00+00:00',
  },
  handoverContactUserIds: [],
  faqs: [{ id: FAQ, question: 'Where do visitors park?', answer: 'Basement P2.' }],
  entries: [],
  documents: [],
}

describe('loadAgentKnowledge', () => {
  it("reads one company's configuration and approved knowledge through whatsapp_agent_knowledge", async () => {
    const db = fakeDb(() => ({ data: knowledge, error: null }))
    await expect(loadAgentKnowledge(db.client, COMPANY)).resolves.toEqual(knowledge)
    expect(db.queries[0]!.table).toBe('rpc:whatsapp_agent_knowledge')
    expect(rpcArgs(db.queries[0]!)).toEqual({ p_company_id: COMPANY })
  })

  it('has no configuration for a company that never saved one', async () => {
    const db = fakeDb(() => ({ data: { ...knowledge, config: null, faqs: [] }, error: null }))
    await expect(loadAgentKnowledge(db.client, COMPANY)).resolves.toMatchObject({ config: null, faqs: [] })
  })

  it('refuses an answer for another company, and reports a failed read as retryable', async () => {
    const other = fakeDb(() => ({ data: { ...knowledge, companyId: '6f1d2c1e-0000-4000-8000-000000000002' }, error: null }))
    await expect(loadAgentKnowledge(other.client, COMPANY)).rejects.toThrow('another company')
    const down = fakeDb(() => ({ data: null, error: { code: 'PGRST000', message: 'unreachable' } }))
    await expect(loadAgentKnowledge(down.client, COMPANY)).rejects.toBeInstanceOf(MessagingReadError)
  })
})
