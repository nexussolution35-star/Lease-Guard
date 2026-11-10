import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common'
import type { ApprovalDecision, EntityId } from '@leaseguard/domain'

import { httpErrorFromDatabase, unwrapDatabase } from '../../common/http/database-errors'
import { saToday } from '../../common/sa-today'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import { type EnqueueOutcome, QueueProducer } from '../../infrastructure/queues/queue-producer'
import { CommunicationLifecycleError, decide, mayHaveBeenSent, mayRetryDelivery } from '../../messaging/communication-lifecycle'
import { currentApproval } from '../../messaging/governing-approval'
import { checkOutbound, MessagingReadError, type OutboundCheckOptions } from '../../messaging/outbound-gate'
import {
  toCommunication,
  toMessageApproval,
  type ApprovalDecisionResult,
  type CommunicationRow,
  type MessageApprovalRow,
} from './communications.mapper'
import type { ApproveCommunicationBody, RejectCommunicationBody } from './communications.schemas'

/** A communication with every approval request made for it. */
type CommunicationForDecision = CommunicationRow & { approvals: MessageApprovalRow[] }

const DECISION_SELECT = '*, approvals:message_approvals!message_approvals_communication_fk(*)' as const

function alreadyApproved(outcome: EnqueueOutcome): ConflictException {
  switch (outcome) {
    case 'already_queued':
      return new ConflictException('This message has already been approved and is waiting for delivery')
    case 'not_retried':
      return new ConflictException(
        'This message has already been approved, but its delivery failed after it may have been sent; check the WhatsApp conversation before sending it again',
      )
    default:
      return new ConflictException('This message has already been approved; its delivery has been queued again')
  }
}

/**
 * The approval workflow for outbound messages: tenant communication requires a property manager's
 * approval before it is sent.
 *
 *   pending_approval --approve--> approved --(message-delivery worker)--> queued → sent → delivered → read
 *   pending_approval --reject---> rejected
 * The decision and the status move are one transition of the communication lifecycle module
 * (`decide`, one database transaction); this service checks the outbound gate first and hands the
 * approved message to the delivery queue after. It writes no status itself. A decision recorded
 * without its status move (directly on the approval request) is finished by repeating the decision.
 */
@Injectable()
export class MessageApprovalsService {
  constructor(private readonly queues: QueueProducer) {}

  /** The current time; a method so tests can control the calendar date. */
  protected now(): Date {
    return new Date()
  }

  async approve(db: DbClient, companyId: EntityId, communicationId: EntityId, body: ApproveCommunicationBody): Promise<ApprovalDecisionResult> {
    const communication = await this.load(db, companyId, communicationId)
    const pending = communication.approvals.find((approval) => approval.decision === 'pending')

    if (!pending) {
      const latest = currentApproval(communication.approvals)
      if (latest?.decision === 'approved') {
        if (communication.status === 'pending_approval') {
          // The decision was recorded but the status update did not complete: finish it. The gate
          // judges the recorded approval, which must name its approver.
          await this.assertDeliverable(db, companyId, communication)
          return this.decide(db, companyId, communication, latest, 'approved', undefined)
        }
        if (communication.status === 'approved') {
          // Not yet sent by the delivery worker: make sure its job will run. A waiting or running job is
          // left alone; one stuck as failed or completed is run again, unless the lifecycle records that
          // the message may already have been sent.
          await this.assertDeliverable(db, companyId, communication)
          const { outcome } = await this.queues.enqueueOrRetry(
            'message-delivery',
            { companyId, communicationId: communication.id },
            { retryFailed: () => mayRetryDelivery(communication) },
          )
          throw alreadyApproved(outcome)
        }
        if (mayHaveBeenSent(communication)) {
          throw new ConflictException(
            'This message has already been approved and may already have been sent; check the WhatsApp conversation before sending it again',
          )
        }
        throw new ConflictException('This message has already been approved')
      }
      throw this.noOpenRequest(communication, latest?.decision)
    }
    this.assertAwaitingDecision(communication)
    // Any writer (company_admin, property_manager) may approve, including the person who requested
    // approval: single-manager companies must be able to send. The decision is recorded with the approver.
    await this.assertDeliverable(db, companyId, communication, { asIfApproved: true })
    return this.decide(db, companyId, communication, pending, 'approved', body.note)
  }

  async reject(db: DbClient, companyId: EntityId, communicationId: EntityId, body: RejectCommunicationBody): Promise<ApprovalDecisionResult> {
    const communication = await this.load(db, companyId, communicationId)
    const pending = communication.approvals.find((approval) => approval.decision === 'pending')

    if (!pending) {
      const latest = currentApproval(communication.approvals)
      if (latest?.decision === 'rejected') {
        if (communication.status === 'pending_approval') {
          // The decision was recorded but the status update did not complete: finish it.
          return this.decide(db, companyId, communication, latest, 'rejected', undefined)
        }
        throw new ConflictException('This message has already been rejected')
      }
      throw this.noOpenRequest(communication, latest?.decision)
    }
    this.assertAwaitingDecision(communication)
    return this.decide(db, companyId, communication, pending, 'rejected', body.note)
  }

  private async load(db: DbClient, companyId: EntityId, communicationId: EntityId): Promise<CommunicationForDecision> {
    const row = unwrapDatabase(
      await db.from('communications').select(DECISION_SELECT).eq('company_id', companyId).eq('id', communicationId).maybeSingle(),
      'Load communication for approval',
    )
    if (row.direction !== 'outbound') throw new ConflictException('Inbound messages are not subject to approval')
    return row
  }

  private assertAwaitingDecision(communication: CommunicationRow): void {
    if (communication.status !== 'pending_approval') {
      throw new ConflictException(`This message is not awaiting approval (status ${communication.status})`)
    }
  }

  private noOpenRequest(communication: CommunicationRow, latestDecision: ApprovalDecision | undefined): ConflictException {
    if (latestDecision === 'rejected') return new ConflictException('This message was rejected and can no longer be approved')
    if (latestDecision === 'approved') return new ConflictException('This message was approved and can no longer be rejected')
    return new ConflictException(`This message has no open approval request (status ${communication.status})`)
  }

  /**
   * Asks the outbound gate whether delivery would send this message: every check the delivery worker
   * applies just before sending (approval naming its approver, recipient and current number, tenant
   * eligibility and arrangement suppression, content, channel, template). Blockers become a 422 that
   * lists every reason, so nothing is approved that delivery would refuse.
   */
  private async assertDeliverable(
    db: DbClient,
    companyId: EntityId,
    communication: CommunicationRow,
    options: OutboundCheckOptions = {},
  ): Promise<void> {
    let verdict
    try {
      verdict = await checkOutbound(db, { companyId, communicationId: communication.id }, saToday(this.now()), options)
    } catch (error) {
      if (error instanceof MessagingReadError) throw httpErrorFromDatabase(error.databaseError, error.operation)
      throw error
    }
    if (!verdict.deliverable) throw new UnprocessableEntityException([...verdict.blockers])
  }

  /**
   * Records the decision through the lifecycle (approval and status in one transaction; the database
   * stamps the signed-in caller as the approver and writes the audit entry), then reloads the message.
   * When two reviewers decide at the same time exactly one succeeds and the other gets a 409. An
   * approved message is handed to the delivery queue.
   */
  private async decide(
    db: DbClient,
    companyId: EntityId,
    communication: CommunicationForDecision,
    approval: MessageApprovalRow,
    decision: Exclude<ApprovalDecision, 'pending'>,
    note: string | undefined,
  ): Promise<ApprovalDecisionResult> {
    const message = { companyId, communicationId: communication.id }
    let outcome
    try {
      outcome = await decide(db, message, { approvalId: approval.id, decision, ...(note !== undefined ? { note } : {}) })
    } catch (error) {
      if (error instanceof CommunicationLifecycleError) throw httpErrorFromDatabase(error.databaseError, error.operation)
      throw error
    }
    switch (outcome) {
      case 'not_found':
        throw new NotFoundException('The record was not found')
      case 'not_pending':
        throw new ConflictException('This message changed while it was being decided; reload the message')
      case 'approval_decided':
        throw new ConflictException('This approval request was decided by someone else; reload the message')
      case 'decided':
        break
    }

    const decided = await this.load(db, companyId, communication.id)
    const decidedApproval = decided.approvals.find((row) => row.id === approval.id) ?? approval
    if (decision === 'approved') await this.enqueueDelivery(companyId, communication.id)
    return { approval: toMessageApproval(decidedApproval), communication: toCommunication(decided, decided.approvals) }
  }

  private async enqueueDelivery(companyId: EntityId, communicationId: EntityId): Promise<void> {
    await this.queues.enqueue('message-delivery', { companyId, communicationId })
  }
}
