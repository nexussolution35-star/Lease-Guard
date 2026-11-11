import type { AgentDecision } from '@leaseguard/domain'

import type { AgentKnowledge } from './agent-knowledge'
import { AGENT_MODEL, type AgentLlm, AgentLlmError, type AgentLlmResult, type AgentPrompt } from './agent-llm'
import type { ConfiguredKnowledge } from './agent-prompt'

/** Test helpers for the AI agent: a company's knowledge and a deterministic fake model that records every prompt. */

export const AGENT_COMPANY = '11111111-1111-4111-8111-111111111111'

export function knowledgeOf(overrides: Partial<AgentKnowledge> = {}): ConfiguredKnowledge {
  return {
    companyId: AGENT_COMPANY,
    config: {
      agentName: 'Atlas assistant',
      businessDescription: 'Atlas Properties lets offices in Sandton.',
      tone: 'Friendly and brief',
      timezone: 'Africa/Johannesburg',
      operatingHours: [{ day: 'monday', opens: '08:00', closes: '17:00' }],
      languages: ['en', 'af'],
      policies: 'No pets in the building.',
      supportInstructions: '',
      escalationRules: 'Security incidents go to the building manager.',
      permittedActions: ['answer_faq'],
      autoReplyEnabled: true,
      outOfHoursMessage: 'We are closed.',
      updatedAt: '2026-11-10T08:00:00Z',
    },
    handoverContactUserIds: [],
    faqs: [
      { id: 'b0000000-0000-4000-8000-000000000002', question: 'Where do visitors park?', answer: 'Basement P2.' },
      { id: 'b0000000-0000-4000-8000-000000000001', question: 'Are you open on Saturdays?', answer: 'No.' },
    ],
    entries: [{ id: 'c0000000-0000-4000-8000-000000000001', title: 'Wi-Fi', content: 'Guest Wi-Fi: AtlasGuest.' }],
    documents: [
      {
        id: 'd0000000-0000-4000-8000-000000000001',
        title: 'Leasing brochure',
        description: 'Floor plans',
        fileName: 'brochure.pdf',
        storagePath: `${AGENT_COMPANY}/d0000000-0000-4000-8000-000000000001/brochure.pdf`,
        mimeType: 'application/pdf',
      },
    ],
    ...overrides,
  } as ConfiguredKnowledge
}


/** What the fake model answers: a decision, a refusal, or an error to throw. */
export type FakeAnswer = AgentDecision | { refusal: true } | AgentLlmError

/**
 * A deterministic stand-in for the model: answers with `answer(prompt)` (or the queued answers in order) and records
 * every prompt it was given, so tests can assert exactly what the model saw.
 */
export class FakeAgentLlm implements AgentLlm {
  readonly prompts: AgentPrompt[] = []

  constructor(private readonly answer: (prompt: AgentPrompt) => FakeAnswer) {}

  static always(answer: FakeAnswer): FakeAgentLlm {
    return new FakeAgentLlm(() => answer)
  }

  async decide(prompt: AgentPrompt): Promise<AgentLlmResult> {
    this.prompts.push(prompt)
    const answer = this.answer(prompt)
    if (answer instanceof AgentLlmError) throw answer
    const call = {
      model: AGENT_MODEL,
      stopReason: 'refusal' in answer ? 'refusal' : 'end_turn',
      usage: { inputTokens: 1200, outputTokens: 60, cacheReadInputTokens: 1000, cacheCreationInputTokens: 0 },
    }
    return 'refusal' in answer ? { kind: 'refusal', ...call } : { kind: 'decision', decision: answer, ...call }
  }
}
