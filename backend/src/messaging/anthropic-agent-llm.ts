import Anthropic from '@anthropic-ai/sdk'

import {
  AGENT_DECISION_JSON_SCHEMA,
  AGENT_MODEL,
  type AgentEffort,
  type AgentLlm,
  AgentLlmError,
  type AgentLlmResult,
  type AgentLlmUsage,
  type AgentPrompt,
  parseAgentDecision,
} from './agent-llm'

/**
 * The AI agent's model through the official Anthropic SDK (worker only: the API never loads ANTHROPIC_API_KEY).
 *
 * - One Messages call per inbound message on AGENT_MODEL, with structured outputs (output_config.format, the decision's
 *   JSON schema) instead of a forced tool, and an explicit effort (WHATSAPP_AGENT_EFFORT, default low). No `thinking`
 *   parameter: this model always thinks adaptively and rejects `disabled` or a token budget.
 * - Server-side refusal fallbacks are on: the beta Messages API with `server-side-fallback-2026-07-01` and
 *   `fallbacks: 'default'`. A final `stop_reason` of `refusal` means the whole chain declined: the caller hands over.
 * - Prompt caching: the fixed instructions and the company's approved knowledge come first, with the cache breakpoint
 *   on the knowledge block, so later messages to the same company read that prefix from the cache; the conversation
 *   and the new message follow.
 * - Errors are mapped by the SDK's typed classes (never by message text) to AgentLlmError: rate limits, overload,
 *   server and connection errors are retryable; a rejected key, permissions or a bad request are not.
 * - WhatsApp data is only sent to answer the message; nothing is used to train or fine-tune a model.
 */

export const AGENT_FALLBACK_BETA = 'server-side-fallback-2026-07-01'
/** Room for the model's adaptive thinking plus the short JSON answer. */
const MAX_TOKENS = 4096

export interface AnthropicAgentLlmOptions {
  apiKey: string
  effort: AgentEffort
  /** For tests: a fake fetch and base URL. Production uses the SDK defaults. */
  fetch?: typeof fetch
  baseURL?: string
  maxRetries?: number
  timeoutMs?: number
}

export class AnthropicAgentLlm implements AgentLlm {
  private readonly client: Anthropic
  private readonly effort: AgentEffort

  constructor(options: AnthropicAgentLlmOptions) {
    this.client = new Anthropic({
      apiKey: options.apiKey,
      maxRetries: options.maxRetries ?? 2,
      timeout: options.timeoutMs ?? 60_000,
      ...(options.fetch ? { fetch: options.fetch } : {}),
      ...(options.baseURL ? { baseURL: options.baseURL } : {}),
    })
    this.effort = options.effort
  }

  async decide(prompt: AgentPrompt): Promise<AgentLlmResult> {
    let response: Anthropic.Beta.BetaMessage
    try {
      response = await this.client.beta.messages.create({
        model: AGENT_MODEL,
        max_tokens: MAX_TOKENS,
        betas: [AGENT_FALLBACK_BETA],
        fallbacks: 'default',
        output_config: { effort: this.effort, format: { type: 'json_schema', schema: AGENT_DECISION_JSON_SCHEMA } },
        system: [
          { type: 'text', text: prompt.instructions },
          { type: 'text', text: prompt.knowledge, cache_control: { type: 'ephemeral' } },
        ],
        messages: toMessages(prompt),
      })
    } catch (error) {
      throw mapError(error)
    }

    const usage = usageOf(response.usage)
    const call = { model: response.model, stopReason: response.stop_reason ?? 'unknown', usage }
    if (response.stop_reason === 'refusal') return { kind: 'refusal', ...call }
    if (response.stop_reason === 'max_tokens') {
      throw new AgentLlmError('The AI model ran out of room before finishing its answer', false, usage)
    }
    const text = response.content
      .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')
    const decision = parseAgentDecision(text)
    if (!decision) throw new AgentLlmError("The AI model's answer was not in the expected format", false, usage)
    return { kind: 'decision', decision, ...call }
  }
}

/** History as alternating turns (the API joins consecutive turns of one role); the first must be the person's. */
function toMessages(prompt: AgentPrompt): Anthropic.Beta.BetaMessageParam[] {
  const firstContact = prompt.history.findIndex((m) => m.from === 'contact')
  const history = firstContact === -1 ? [] : prompt.history.slice(firstContact)
  return [
    ...history.map((m): Anthropic.Beta.BetaMessageParam => ({ role: m.from === 'contact' ? 'user' : 'assistant', content: m.text })),
    { role: 'user', content: prompt.turn },
  ]
}

function usageOf(usage: Anthropic.Beta.BetaUsage): AgentLlmUsage {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
    cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
  }
}

function mapError(error: unknown): AgentLlmError {
  if (error instanceof Anthropic.RateLimitError) return new AgentLlmError('Claude is rate limiting requests; trying again later', true)
  if (error instanceof Anthropic.APIConnectionError) return new AgentLlmError('Claude could not be reached', true)
  if (error instanceof Anthropic.InternalServerError) return new AgentLlmError(`Claude is unavailable (HTTP ${error.status})`, true)
  if (error instanceof Anthropic.AuthenticationError) return new AgentLlmError('The Anthropic API key was rejected', false)
  if (error instanceof Anthropic.PermissionDeniedError) return new AgentLlmError('The Anthropic API key may not use this model', false)
  if (error instanceof Anthropic.BadRequestError) return new AgentLlmError('Claude rejected the request', false)
  if (error instanceof Anthropic.APIError) {
    const status = typeof error.status === 'number' ? error.status : 0
    return new AgentLlmError(`Claude returned an error (HTTP ${status || 'unknown'})`, status >= 500 || status === 408 || status === 409)
  }
  return new AgentLlmError('Unexpected error calling Claude', true)
}
