import type { EntityId, WhatsAppAgentRun } from '@leaseguard/domain'

/**
 * How the inbox shows what the company's AI agent did with a message (ticket 10). The agent's suggested replies are
 * internal: shown to staff, never sent. Tenants are never answered automatically.
 */

/** One line for staff on the run's outcome. */
export function agentRunSummary(run: WhatsAppAgentRun): string {
  if (run.status !== 'completed' || !run.outcome) return 'The AI agent is still working on this message'
  switch (run.outcome) {
    case 'replied':
      return 'The AI agent answered this message'
    case 'out_of_hours':
      return 'The AI agent sent the out-of-hours message and asked for a person'
    case 'handed_over':
      return 'The AI agent asked for a person'
    case 'ignored':
      return 'The AI agent found nothing to answer'
    case 'not_configured':
      return 'The AI agent is not set up, so it did not handle this message'
  }
}

/** The agent's runs by the inbound message they handled. */
export function runsByMessage(runs: readonly WhatsAppAgentRun[] | undefined): ReadonlyMap<EntityId, WhatsAppAgentRun> {
  return new Map((runs ?? []).map((run) => [run.communicationId, run]))
}

/** The ids of the messages the agent sent (its answers and out-of-hours messages). */
export function agentReplyIds(runs: readonly WhatsAppAgentRun[] | undefined): ReadonlySet<EntityId> {
  return new Set((runs ?? []).flatMap((run) => (run.replyCommunicationId ? [run.replyCommunicationId] : [])))
}
