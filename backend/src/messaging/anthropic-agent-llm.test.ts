import { describe, expect, it } from 'vitest'

import { AgentLlmError, type AgentPrompt } from './agent-llm'
import { AGENT_FALLBACK_BETA, AnthropicAgentLlm } from './anthropic-agent-llm'

/** Never the real API: every request goes to this fake fetch. */
const BASE_URL = 'http://anthropic.test'

interface Captured {
  url: string
  headers: Headers
  body: Record<string, unknown>
}

function fakeApi(status: number, body: unknown) {
  const calls: Captured[] = []
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init)
    calls.push({ url: request.url, headers: request.headers, body: JSON.parse(await request.text()) as Record<string, unknown> })
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'request-id': 'req_test' } })
  }) as typeof fetch
  const llm = new AnthropicAgentLlm({ apiKey: 'sk-ant-test-not-real', effort: 'low', fetch: fetchFn, baseURL: BASE_URL, maxRetries: 0 })
  return { llm, calls }
}

const PROMPT: AgentPrompt = {
  instructions: 'INSTRUCTIONS',
  knowledge: '<company>KNOWLEDGE</company>',
  history: [
    { from: 'business', text: 'Earlier reply' },
    { from: 'contact', text: '<message>Hi</message>' },
    { from: 'business', text: '<message>Hello!</message>' },
  ],
  turn: 'TURN',
}

function message(stopReason: string, text: string, model = 'claude-opus-5-5') {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model,
    content: [{ type: 'text', text }],
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 40, output_tokens: 30, cache_read_input_tokens: 1500, cache_creation_input_tokens: 0 },
  }
}

const DECISION = JSON.stringify({ action: 'reply', reply_text: 'Basement P2.', handover_reason: '', category: 'faq', confidence: 0.9 })

describe('AnthropicAgentLlm', () => {
  it('asks Claude once with structured output, effort, refusal fallbacks and a cached knowledge prefix', async () => {
    const { llm, calls } = fakeApi(200, message('end_turn', DECISION))
    const result = await llm.decide(PROMPT)

    expect(result).toEqual({
      kind: 'decision',
      decision: { action: 'reply', replyText: 'Basement P2.', category: 'faq', confidence: 0.9 },
      model: 'claude-opus-5-5',
      stopReason: 'end_turn',
      usage: { inputTokens: 40, outputTokens: 30, cacheReadInputTokens: 1500, cacheCreationInputTokens: 0 },
    })
    expect(calls).toHaveLength(1)
    const [call] = calls
    expect(call!.url).toBe(`${BASE_URL}/v1/messages`)
    expect(call!.headers.get('anthropic-beta')).toBe(AGENT_FALLBACK_BETA)
    expect(call!.body).toMatchObject({
      model: 'claude-opus-5-5',
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema' } },
      system: [
        { type: 'text', text: 'INSTRUCTIONS' },
        { type: 'text', text: '<company>KNOWLEDGE</company>', cache_control: { type: 'ephemeral' } },
      ],
      // The history starts with the person's message; the new message comes last.
      messages: [
        { role: 'user', content: '<message>Hi</message>' },
        { role: 'assistant', content: '<message>Hello!</message>' },
        { role: 'user', content: 'TURN' },
      ],
    })
    // Never a forced tool, never thinking disabled or a budget (both rejected by this model).
    expect(call!.body).not.toHaveProperty('thinking')
    expect(call!.body).not.toHaveProperty('tool_choice')
    expect(call!.body).not.toHaveProperty('tools')
    const schema = (call!.body.output_config as { format: { schema: { required: string[]; additionalProperties: boolean } } }).format.schema
    expect(schema.required).toEqual(['action', 'reply_text', 'handover_reason', 'category', 'confidence'])
    expect(schema.additionalProperties).toBe(false)
  })

  it('reports a refusal of the whole fallback chain', async () => {
    const { llm } = fakeApi(200, message('refusal', ''))
    await expect(llm.decide(PROMPT)).resolves.toMatchObject({ kind: 'refusal', stopReason: 'refusal' })
  })

  it('reports the model that answered when a fallback model served the request', async () => {
    const { llm } = fakeApi(200, message('end_turn', DECISION, 'claude-opus-4-8'))
    await expect(llm.decide(PROMPT)).resolves.toMatchObject({ kind: 'decision', model: 'claude-opus-4-8' })
  })

  it('refuses an answer that is cut off or not in the format', async () => {
    const cut = fakeApi(200, message('max_tokens', '{"action":'))
    await expect(cut.llm.decide(PROMPT)).rejects.toMatchObject({ retryable: false })
    const wrong = fakeApi(200, message('end_turn', '{"action":"send"}'))
    await expect(wrong.llm.decide(PROMPT)).rejects.toMatchObject({ retryable: false, message: expect.stringMatching(/format/) })
  })

  it.each([
    [429, true],
    [500, true],
    [529, true],
    [401, false],
    [403, false],
    [400, false],
  ])('maps HTTP %i by the SDK error class (retryable: %s)', async (status, retryable) => {
    const { llm } = fakeApi(status, { type: 'error', error: { type: 'some_error', message: 'nope' } })
    const error = await llm.decide(PROMPT).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AgentLlmError)
    expect((error as AgentLlmError).retryable).toBe(retryable)
    expect((error as AgentLlmError).message).not.toContain('sk-ant')
  })

  it('treats an unreachable API as retryable', async () => {
    const llm = new AnthropicAgentLlm({
      apiKey: 'sk-ant-test-not-real',
      effort: 'low',
      baseURL: BASE_URL,
      maxRetries: 0,
      fetch: (async () => {
        throw new TypeError('fetch failed')
      }) as typeof fetch,
    })
    await expect(llm.decide(PROMPT)).rejects.toMatchObject({ retryable: true })
  })
})
