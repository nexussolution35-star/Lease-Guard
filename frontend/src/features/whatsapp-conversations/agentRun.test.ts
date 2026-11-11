import type { WhatsAppAgentRun } from '@leaseguard/domain'
import { describe, expect, it } from 'vitest'

import { agentReplyIds, agentRunSummary, runsByMessage } from './agentRun'

const run = (overrides: Partial<WhatsAppAgentRun>): WhatsAppAgentRun => ({
  id: 'r-1',
  companyId: 'c-1',
  conversationId: 'w-1',
  communicationId: 'm-1',
  status: 'completed',
  outcome: 'replied',
  createdAt: '2026-11-10T08:00:00Z',
  updatedAt: '2026-11-10T08:00:00Z',
  ...overrides,
})

describe('agent run presentation', () => {
  it('describes every outcome', () => {
    expect(agentRunSummary(run({}))).toBe('The AI agent answered this message')
    expect(agentRunSummary(run({ outcome: 'out_of_hours' }))).toMatch(/out-of-hours/)
    expect(agentRunSummary(run({ outcome: 'handed_over' }))).toBe('The AI agent asked for a person')
    expect(agentRunSummary(run({ outcome: 'ignored' }))).toMatch(/nothing to answer/)
    expect(agentRunSummary(run({ outcome: 'not_configured' }))).toMatch(/not set up/)
    expect(agentRunSummary(run({ status: 'started', outcome: undefined }))).toMatch(/still working/)
  })

  it('indexes runs by message and finds the messages the agent sent', () => {
    const runs = [run({}), run({ id: 'r-2', communicationId: 'm-2', outcome: 'handed_over' }), run({ id: 'r-3', communicationId: 'm-3', replyCommunicationId: 'm-4' })]
    expect(runsByMessage(runs).get('m-2')?.id).toBe('r-2')
    expect([...agentReplyIds(runs)]).toEqual(['m-4'])
    expect(runsByMessage(undefined).size).toBe(0)
  })
})
