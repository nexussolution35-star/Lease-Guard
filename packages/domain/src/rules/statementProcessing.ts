import type { Statement, ZAR } from '../types/index.js'

/**
 * Automatic extraction gave up on this statement: the worker left it `review_required` with the reason in
 * `processingError` (unreadable PDF, file too large, retries exhausted). A writer can queue it again; until
 * then the figures can only be entered by hand.
 */
export function processingFailed(statement: Pick<Statement, 'status' | 'processingError'>): boolean {
  return statement.status === 'review_required' && (statement.processingError ?? '').trim() !== ''
}

/**
 * The closing balance a statement may be shown with: only a verified statement's balance is a monitoring
 * record. Anything else (an extraction proposal, a rejected or duplicate statement) has no balance to show.
 */
export function verifiedClosingBalance(statement: Pick<Statement, 'status' | 'closingBalance'>): ZAR | undefined {
  return statement.status === 'verified' ? statement.closingBalance : undefined
}
