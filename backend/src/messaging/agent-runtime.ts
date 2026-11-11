import {
  type AgentModelResult,
  type AgentRunOutcome,
  applyAgentPolicy,
  customerServiceWindow,
  type EntityId,
  type ISODateTime,
} from '@leaseguard/domain'

import type { AgentKnowledge } from './agent-knowledge'
import { type AgentHistoryMessage, type AgentLlm, AgentLlmError, type AgentLlmResult, type AgentLlmUsage } from './agent-llm'
import { buildAgentPrompt, type ConfiguredKnowledge } from './agent-prompt'

/**
 * The AI agent runtime (ticket 10): what happens to one inbound WhatsApp message. Deep module: the caller (the worker's
 * `whatsapp-agent` queue) passes the company and the inbound message; the runtime
 *
 * 1. starts the message's one run (a retried job finds it: a completed run never runs or sends again);
 * 2. loads ONLY that company's approved agent configuration and knowledge and that conversation's messages;
 * 3. asks the model once, with a prompt built from them (agent-prompt.ts), when the company configured its agent;
 * 4. applies the agent policy in code (@leaseguard/domain applyAgentPolicy): tenants never answered, guards, hours;
 * 5. completes the run in one transaction (reply created agent-approved, handover, notifications, usage) and hands the
 *    reply to delivery, which sends it through the outbound gate, the lifecycle and the company's channel.
 *
 * The database side sits behind AgentRunStore (agent-run-store.ts) and the model behind AgentLlm, so the runtime is
 * tested with an in-memory store and a fake model, and the store against local Postgres.
 */

export interface AgentRunRef {
  readonly companyId: EntityId
  /** The inbound message. */
  readonly communicationId: EntityId
}

export type AgentRunStart =
  | { outcome: 'not_found' }
  | { outcome: 'started' | 'running'; runId: EntityId; conversationId: EntityId }
  | { outcome: 'completed'; runId: EntityId; conversationId: EntityId; replyCommunicationId?: EntityId }

/** What the agent may know about the message, all of one company. */
export interface AgentRunContext {
  inboundText: string
  /** `tenant` when the contact is linked to, or has the number of, a tenant of the company. */
  sender: 'tenant' | 'contact'
  contactHasNumber: boolean
  lastInboundAt?: ISODateTime
  /** The conversation has an unresolved handover. */
  humanHandling: boolean
  /** Earlier messages of the conversation, oldest first. */
  history: AgentHistoryMessage[]
  knowledge: AgentKnowledge
}

/** What the run did, as complete_whatsapp_agent_run records it. */
export interface AgentRunRecord {
  outcome: AgentRunOutcome
  category?: string
  confidence?: number
  handoverReason?: string
  suggestedReply?: string
  replyText?: string
  outOfHoursSince?: ISODateTime
  model?: string
  stopReason?: string
  usage?: AgentLlmUsage
  latencyMs?: number
  errorMessage?: string
}

export type AgentRunCompletion =
  | { outcome: 'not_found' }
  | { outcome: 'completed' | 'already_completed'; runOutcome: AgentRunOutcome; replyCommunicationId?: EntityId; handoverId?: EntityId; notified: number }

export interface AgentRunStore {
  start(ref: AgentRunRef): Promise<AgentRunStart>
  context(ref: AgentRunRef, conversationId: EntityId): Promise<AgentRunContext | null>
  complete(companyId: EntityId, runId: EntityId, record: AgentRunRecord): Promise<AgentRunCompletion>
}

export interface AgentRuntimeDeps {
  store: AgentRunStore
  /** Null when the worker has no Anthropic API key: every message is handed to a person. */
  llm: AgentLlm | null
  /** Queues the delivery of a reply the run created (idempotent: one delivery job per message). */
  deliver(message: { companyId: EntityId; communicationId: EntityId }): Promise<void>
  now(): Date
}

export type AgentRunResult =
  | { outcome: 'not_found' }
  | { outcome: 'already_completed'; replyCommunicationId?: EntityId }
  | { outcome: 'completed'; runOutcome: AgentRunOutcome; replyCommunicationId?: EntityId; handoverId?: EntityId; notified: number }

export interface AgentRunOptions {
  /** The job's last attempt: a model failure that could still pass is handed over instead of retried. */
  finalAttempt: boolean
}

function hasConfig(knowledge: AgentKnowledge): knowledge is ConfiguredKnowledge {
  return knowledge.config !== null
}

/** Runs the agent on one inbound message. Throws AgentLlmError (retryable) to have the job retried. */
export async function runAgent(deps: AgentRuntimeDeps, ref: AgentRunRef, options: AgentRunOptions): Promise<AgentRunResult> {
  const started = await deps.store.start(ref)
  if (started.outcome === 'not_found') return { outcome: 'not_found' }
  if (started.outcome === 'completed') {
    // Done before: never run or send again, but make sure its reply reached delivery (a crash may have come between).
    if (started.replyCommunicationId) await deps.deliver({ companyId: ref.companyId, communicationId: started.replyCommunicationId })
    return { outcome: 'already_completed', ...(started.replyCommunicationId ? { replyCommunicationId: started.replyCommunicationId } : {}) }
  }

  const context = await deps.store.context(ref, started.conversationId)
  if (!context) return { outcome: 'not_found' }

  let record: AgentRunRecord
  if (!hasConfig(context.knowledge)) {
    // The company never set up its agent: nothing runs, the message simply waits in the inbox.
    record = { outcome: 'not_configured' }
  } else {
    const { config } = context.knowledge
    const { model, call, latencyMs, errorMessage } = await askModel(deps, context, context.knowledge, options)
    const now = deps.now()
    const policy = applyAgentPolicy({
      sender: context.sender,
      config: {
        autoReplyEnabled: config.autoReplyEnabled,
        permittedActions: config.permittedActions,
        operatingHours: config.operatingHours,
        timezone: config.timezone,
        outOfHoursMessage: config.outOfHoursMessage ?? undefined,
      },
      model,
      inboundText: context.inboundText,
      windowOpen: customerServiceWindow(context.lastInboundAt, now).open,
      contactHasNumber: context.contactHasNumber,
      humanHandling: context.humanHandling,
      now,
    })
    const decision = model.kind === 'decision' ? model.decision : undefined
    record = {
      outcome: policy.outcome,
      ...(decision ? { category: decision.category, confidence: decision.confidence } : {}),
      ...(policy.handoverReason ? { handoverReason: policy.handoverReason } : {}),
      ...(policy.suggestedReply ? { suggestedReply: policy.suggestedReply } : {}),
      ...(policy.reply ? { replyText: policy.reply.text } : {}),
      ...(policy.outOfHoursSince ? { outOfHoursSince: policy.outOfHoursSince } : {}),
      ...(call ? { model: call.model, stopReason: call.stopReason, usage: call.usage } : {}),
      ...(latencyMs !== undefined ? { latencyMs } : {}),
      ...(errorMessage ? { errorMessage } : {}),
    }
  }

  const completion = await deps.store.complete(ref.companyId, started.runId, record)
  if (completion.outcome === 'not_found') return { outcome: 'not_found' }
  if (completion.replyCommunicationId) await deps.deliver({ companyId: ref.companyId, communicationId: completion.replyCommunicationId })
  if (completion.outcome === 'already_completed') {
    return { outcome: 'already_completed', ...(completion.replyCommunicationId ? { replyCommunicationId: completion.replyCommunicationId } : {}) }
  }
  return {
    outcome: 'completed',
    runOutcome: completion.runOutcome,
    notified: completion.notified,
    ...(completion.replyCommunicationId ? { replyCommunicationId: completion.replyCommunicationId } : {}),
    ...(completion.handoverId ? { handoverId: completion.handoverId } : {}),
  }
}

interface ModelAnswer {
  model: AgentModelResult
  call?: Pick<AgentLlmResult, 'model' | 'stopReason' | 'usage'>
  latencyMs?: number
  errorMessage?: string
}

/** One call to the model, as the policy's input. Retryable failures are rethrown until the last attempt. */
async function askModel(deps: AgentRuntimeDeps, context: AgentRunContext, knowledge: ConfiguredKnowledge, options: AgentRunOptions): Promise<ModelAnswer> {
  if (!deps.llm) return { model: { kind: 'unavailable' } }
  const prompt = buildAgentPrompt(knowledge, { sender: context.sender, text: context.inboundText, history: context.history })
  const startedAt = Date.now()
  try {
    const result = await deps.llm.decide(prompt)
    const latencyMs = Date.now() - startedAt
    const call = { model: result.model, stopReason: result.stopReason, usage: result.usage }
    return result.kind === 'refusal'
      ? { model: { kind: 'refusal' }, call, latencyMs }
      : { model: { kind: 'decision', decision: result.decision }, call, latencyMs }
  } catch (error) {
    const failure = error instanceof AgentLlmError ? error : new AgentLlmError('Unexpected error calling the AI model', true)
    if (failure.retryable && !options.finalAttempt) throw failure
    return { model: { kind: 'error', reason: failure.message }, latencyMs: Date.now() - startedAt, errorMessage: failure.message }
  }
}
