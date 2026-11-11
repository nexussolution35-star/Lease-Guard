import type { AgentDecision } from '@leaseguard/domain'
import { describe, expect, it } from 'vitest'

import { FakeAgentLlm, knowledgeOf } from './agent.test-helpers'
import { AgentLlmError } from './agent-llm'
import {
  type AgentRunCompletion,
  type AgentRunContext,
  type AgentRunRecord,
  type AgentRunRef,
  type AgentRunStart,
  type AgentRunStore,
  type AgentRuntimeDeps,
  runAgent,
} from './agent-runtime'

const COMPANY = '11111111-1111-4111-8111-111111111111'
const MESSAGE = 'a1111111-1111-4111-8111-111111111111'
const REF: AgentRunRef = { companyId: COMPANY, communicationId: MESSAGE }
// Monday 9 November 2026; knowledgeOf() is open on Mondays 08:00-17:00 SAST.
const MONDAY_10AM = new Date('2026-11-09T08:00:00Z')
const MONDAY_8PM = new Date('2026-11-09T18:00:00Z')

const FAQ: AgentDecision = { action: 'reply', replyText: 'Visitors park in basement P2.', category: 'faq', confidence: 0.93 }

/** An in-memory store with the database's once-only behaviour. */
class MemoryStore implements AgentRunStore {
  run: { status: 'started' | 'completed'; record?: AgentRunRecord; replyId?: string } | null = null
  completions = 0
  contextCalls = 0

  constructor(private readonly ctx: AgentRunContext | null) {}

  async start(ref: AgentRunRef): Promise<AgentRunStart> {
    if (ref.communicationId !== MESSAGE) return { outcome: 'not_found' }
    if (!this.run) {
      this.run = { status: 'started' }
      return { outcome: 'started', runId: 'run-1', conversationId: 'conv-1' }
    }
    if (this.run.status === 'completed') {
      return { outcome: 'completed', runId: 'run-1', conversationId: 'conv-1', ...(this.run.replyId ? { replyCommunicationId: this.run.replyId } : {}) }
    }
    return { outcome: 'running', runId: 'run-1', conversationId: 'conv-1' }
  }

  async context(): Promise<AgentRunContext | null> {
    this.contextCalls += 1
    return this.ctx
  }

  async complete(_companyId: string, _runId: string, record: AgentRunRecord): Promise<AgentRunCompletion> {
    if (!this.run) return { outcome: 'not_found' }
    if (this.run.status === 'completed') {
      return { outcome: 'already_completed', runOutcome: this.run.record!.outcome, notified: 0, ...(this.run.replyId ? { replyCommunicationId: this.run.replyId } : {}) }
    }
    this.completions += 1
    const replyId = record.replyText ? 'reply-1' : undefined
    this.run = { status: 'completed', record, ...(replyId ? { replyId } : {}) }
    const handedOver = record.outcome === 'handed_over' || record.outcome === 'out_of_hours'
    return {
      outcome: 'completed',
      runOutcome: record.outcome,
      notified: handedOver ? 1 : 0,
      ...(replyId ? { replyCommunicationId: replyId } : {}),
      ...(handedOver ? { handoverId: 'handover-1' } : {}),
    }
  }
}

function context(overrides: Partial<AgentRunContext> = {}): AgentRunContext {
  return {
    inboundText: 'Where can visitors park?',
    sender: 'contact',
    contactHasNumber: true,
    lastInboundAt: new Date(MONDAY_10AM.getTime() - 60_000).toISOString(),
    humanHandling: false,
    history: [{ from: 'contact', text: 'Hello' }],
    knowledge: knowledgeOf(),
    ...overrides,
  }
}

function harness(options: { ctx?: AgentRunContext | null; llm?: FakeAgentLlm | null; now?: Date } = {}) {
  const store = new MemoryStore(options.ctx === undefined ? context() : options.ctx)
  const llm = options.llm === undefined ? FakeAgentLlm.always(FAQ) : options.llm
  const delivered: string[] = []
  const deps: AgentRuntimeDeps = {
    store,
    llm,
    deliver: async ({ communicationId }) => {
      delivered.push(communicationId)
    },
    now: () => options.now ?? MONDAY_10AM,
  }
  return { store, llm, delivered, run: (finalAttempt = false) => runAgent(deps, REF, { finalAttempt }) }
}

describe('runAgent', () => {
  it("answers a contact's FAQ inside the window and operating hours, and hands the reply to delivery", async () => {
    const { run, store, delivered, llm } = harness()
    await expect(run()).resolves.toEqual({ outcome: 'completed', runOutcome: 'replied', replyCommunicationId: 'reply-1', notified: 0 })
    expect(delivered).toEqual(['reply-1'])
    expect(store.run?.record).toMatchObject({
      outcome: 'replied',
      replyText: FAQ.replyText,
      category: 'faq',
      confidence: 0.93,
      model: 'claude-opus-5-5',
      stopReason: 'end_turn',
      usage: { inputTokens: 1200, outputTokens: 60, cacheReadInputTokens: 1000, cacheCreationInputTokens: 0 },
    })
    expect(store.run?.record?.latencyMs).toBeGreaterThanOrEqual(0)
    expect(llm?.prompts).toHaveLength(1)
    expect(llm?.prompts[0]?.turn).toContain('Where can visitors park?')
    expect(llm?.prompts[0]?.history).toEqual([{ from: 'contact', text: '<message>Hello</message>' }])
  })

  it('never sends anything to a tenant: an internal suggestion and a handover', async () => {
    const { run, store, delivered } = harness({ ctx: context({ sender: 'tenant' }) })
    const result = await run()
    expect(result).toMatchObject({ outcome: 'completed', runOutcome: 'handed_over', handoverId: 'handover-1', notified: 1 })
    expect(delivered).toEqual([])
    expect(store.run?.record?.replyText).toBeUndefined()
    expect(store.run?.record?.handoverReason).toMatch(/tenant/i)
  })

  it('runs once per message: a retried job neither asks the model nor sends again', async () => {
    const { run, store, delivered, llm } = harness()
    await run()
    await expect(run()).resolves.toEqual({ outcome: 'already_completed', replyCommunicationId: 'reply-1' })
    expect(llm?.prompts).toHaveLength(1)
    expect(store.completions).toBe(1)
    // Delivery is asked again with the same message; its job id and the lifecycle's claim make that a no-op.
    expect(delivered).toEqual(['reply-1', 'reply-1'])
  })

  it('does nothing for a company that never configured its agent', async () => {
    const { run, store, llm, delivered } = harness({ ctx: context({ knowledge: knowledgeOf({ config: null }) }) })
    await expect(run()).resolves.toMatchObject({ runOutcome: 'not_configured' })
    expect(llm?.prompts).toHaveLength(0)
    expect(store.run?.record).toEqual({ outcome: 'not_configured' })
    expect(delivered).toEqual([])
  })

  it('hands over when the worker has no model', async () => {
    const { run, store } = harness({ llm: null })
    await expect(run()).resolves.toMatchObject({ runOutcome: 'handed_over' })
    expect(store.run?.record?.handoverReason).toMatch(/not available/)
  })

  it('retries a passing model failure, and hands over on the last attempt', async () => {
    const { run, store, delivered } = harness({ llm: FakeAgentLlm.always(new AgentLlmError('Claude is rate limited; try again later', true)) })
    await expect(run()).rejects.toBeInstanceOf(AgentLlmError)
    expect(store.run?.status).toBe('started')
    await expect(run(true)).resolves.toMatchObject({ runOutcome: 'handed_over' })
    expect(store.run?.record).toMatchObject({ errorMessage: 'Claude is rate limited; try again later' })
    expect(store.run?.record?.handoverReason).toMatch(/rate limited/)
    expect(delivered).toEqual([])
  })

  it('hands over a permanent model failure at once', async () => {
    const { run } = harness({ llm: FakeAgentLlm.always(new AgentLlmError('The Anthropic API key was rejected', false)) })
    await expect(run()).resolves.toMatchObject({ runOutcome: 'handed_over' })
  })

  it('hands over a refusal', async () => {
    const { run, store, delivered } = harness({ llm: FakeAgentLlm.always({ refusal: true }) })
    await expect(run()).resolves.toMatchObject({ runOutcome: 'handed_over' })
    expect(store.run?.record).toMatchObject({ stopReason: 'refusal' })
    expect(store.run?.record?.handoverReason).toMatch(/declined/)
    expect(delivered).toEqual([])
  })

  it('hands over an answer with bank details, and payment or dispute questions', async () => {
    const bank = harness({ llm: FakeAgentLlm.always({ ...FAQ, replyText: 'Use account 62812345678 at FNB.' }) })
    await expect(bank.run()).resolves.toMatchObject({ runOutcome: 'handed_over' })
    expect(bank.delivered).toEqual([])
    expect(bank.store.run?.record?.suggestedReply).toBeUndefined()

    const payment = harness({ llm: FakeAgentLlm.always({ ...FAQ, category: 'payment_or_arrangement' }) })
    await expect(payment.run()).resolves.toMatchObject({ runOutcome: 'handed_over' })
    const dispute = harness({ ctx: context({ inboundText: 'I dispute the charge' }) })
    await expect(dispute.run()).resolves.toMatchObject({ runOutcome: 'handed_over' })
  })

  it('sends no free-form answer outside the 24-hour window', async () => {
    const { run, delivered } = harness({ ctx: context({ lastInboundAt: new Date(MONDAY_10AM.getTime() - 25 * 3_600_000).toISOString() }) })
    await expect(run()).resolves.toMatchObject({ runOutcome: 'handed_over' })
    expect(delivered).toEqual([])
  })

  it('sends the out-of-hours message outside operating hours, naming its window', async () => {
    const { run, store, delivered } = harness({ now: MONDAY_8PM, ctx: context({ lastInboundAt: MONDAY_8PM.toISOString() }) })
    await expect(run()).resolves.toMatchObject({ runOutcome: 'out_of_hours', replyCommunicationId: 'reply-1' })
    expect(store.run?.record).toMatchObject({ replyText: 'We are closed.', outOfHoursSince: '2026-11-09T15:00:00.000Z' })
    expect(delivered).toEqual(['reply-1'])
  })

  it('stops for a message that is not an inbound message of the company', async () => {
    const { store } = harness()
    const deps: AgentRuntimeDeps = { store, llm: null, deliver: async () => undefined, now: () => MONDAY_10AM }
    await expect(runAgent(deps, { companyId: COMPANY, communicationId: 'other' }, { finalAttempt: false })).resolves.toEqual({ outcome: 'not_found' })
  })
})
