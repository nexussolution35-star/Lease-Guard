import { AGENT_ACTIONS, AGENT_MESSAGE_CATEGORIES, type AgentDecision } from '@leaseguard/domain'
import { z } from 'zod'

/**
 * The seam between the AI agent runtime (agent-runtime.ts) and a language model. One structured call per inbound
 * message: the runtime hands over a prompt built only from the company's own approved knowledge and the conversation,
 * and gets back the model's proposed decision, a refusal, or an AgentLlmError. What happens next is decided in code
 * (@leaseguard/domain applyAgentPolicy), never by the model.
 *
 * Adapters: Anthropic (infrastructure/anthropic/anthropic-agent-llm.ts, worker only, ANTHROPIC_API_KEY) and a
 * deterministic fake for tests (fake-agent-llm.test-helpers.ts).
 */

/** The model the agent uses (the owner's default). */
export const AGENT_MODEL = 'claude-opus-5-5'

export const AGENT_EFFORTS = ['low', 'medium', 'high'] as const
export type AgentEffort = (typeof AGENT_EFFORTS)[number]

/** One earlier message of the conversation. */
export interface AgentHistoryMessage {
  from: 'contact' | 'business'
  text: string
}

/**
 * What the model sees, in cache order: `instructions` (identical for every company and request), then `knowledge`
 * (the company's approved information, deterministic, so repeated messages to one company reuse the cache), then the
 * conversation and this turn, which change every time.
 */
export interface AgentPrompt {
  instructions: string
  knowledge: string
  history: readonly AgentHistoryMessage[]
  turn: string
}

export interface AgentLlmUsage {
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
}

export interface AgentLlmCall {
  /** The model that answered (a server-side fallback model may have answered instead of AGENT_MODEL). */
  model: string
  stopReason: string
  usage: AgentLlmUsage
}

export type AgentLlmResult = ({ kind: 'decision'; decision: AgentDecision } | { kind: 'refusal' }) & AgentLlmCall

/**
 * The model could not be asked or its answer could not be used. `retryable`: asking again later may work (rate limit,
 * overload, network); the job retries, and after its last attempt the conversation is handed to a person. The message
 * is safe to store and show: never the request, a key or message text.
 */
export class AgentLlmError extends Error {
  readonly retryable: boolean
  readonly usage: AgentLlmUsage | undefined

  constructor(message: string, retryable: boolean, usage?: AgentLlmUsage) {
    super(message)
    this.name = 'AgentLlmError'
    this.retryable = retryable
    this.usage = usage
  }
}

export interface AgentLlm {
  decide(prompt: AgentPrompt): Promise<AgentLlmResult>
}

// ------------------------------------------------------------------ the decision format

/**
 * The JSON schema the model's answer must follow (structured outputs: output_config.format). Every property is
 * required and nothing else is allowed; empty strings stand for "none".
 */
export const AGENT_DECISION_JSON_SCHEMA = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: [...AGENT_ACTIONS], description: 'reply: answer the message; handover: a person must respond; ignore: nothing to answer.' },
    reply_text: { type: 'string', description: 'The answer to send (reply), or a suggested answer for staff (handover). Empty when there is none.' },
    handover_reason: { type: 'string', description: 'Why a person must respond (handover). Empty otherwise.' },
    category: { type: 'string', enum: [...AGENT_MESSAGE_CATEGORIES] },
    confidence: { type: 'number', description: 'How sure you are, from 0 to 1, that the decision and answer are right and fully supported by the approved information.' },
  },
  required: ['action', 'reply_text', 'handover_reason', 'category', 'confidence'],
  additionalProperties: false,
} as const

const decisionSchema = z.object({
  action: z.enum(AGENT_ACTIONS),
  reply_text: z.string(),
  handover_reason: z.string(),
  category: z.enum(AGENT_MESSAGE_CATEGORIES),
  confidence: z.number(),
})

/** The model's JSON answer as an AgentDecision, or null when it does not follow the schema. */
export function parseAgentDecision(text: string): AgentDecision | null {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return null
  }
  const parsed = decisionSchema.safeParse(json)
  if (!parsed.success) return null
  const { action, reply_text: replyText, handover_reason: handoverReason, category, confidence } = parsed.data
  return {
    action,
    category,
    confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0,
    ...(replyText.trim() ? { replyText: replyText.trim() } : {}),
    ...(handoverReason.trim() ? { handoverReason: handoverReason.trim().slice(0, 500) } : {}),
  }
}
