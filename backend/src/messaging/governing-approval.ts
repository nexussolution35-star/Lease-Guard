import type { Tables } from '../infrastructure/database/database.types'

type ApprovalSummary = Pick<Tables<'message_approvals'>, 'id' | 'decision' | 'requested_at'>

/**
 * The approval that currently governs a message: the open (pending) request when there is one,
 * otherwise the most recently requested decision. The same rule as the database's approval guard
 * (`private.guard_tenant_message_approval`), so the gate and the guard judge the same approval.
 */
export function currentApproval<A extends ApprovalSummary>(approvals: readonly A[]): A | undefined {
  const pending = approvals.find((approval) => approval.decision === 'pending')
  if (pending) return pending
  return [...approvals].sort(
    (a, b) => b.requested_at.localeCompare(a.requested_at) || b.id.localeCompare(a.id),
  )[0]
}
