import { useMemo } from 'react'

import { canSendTenantMessage, type EligibilityResult } from '@/domain/communicationEligibility'
import { todayISO } from '@/store/ids'
import type { AuditLog, Communication, EntityId, ISODate, MessageApproval, MessageTemplate, Property, Tenant, User } from '@/types'

import { approveMessage, approvalsRepo, rejectMessage } from '@/services/communications'
import { getScopedData, indexById, useScopedData, type ScopedData } from '@/services/snapshot'

/** A message approval joined with everything a reviewer needs to decide. */
export interface ApprovalQueueItem {
  approval: MessageApproval
  communication: Communication
  tenant?: Tenant
  owner?: User
  template?: MessageTemplate
  property?: Property
  requestedBy?: User
  /**
   * Whether the message could be sent once approved: every eligibility rule EXCEPT the approval
   * itself (verified number, opt-out, arrangement suppression, …).
   */
  eligibility: EligibilityResult
}

export interface ApprovalDetails extends ApprovalQueueItem {
  history: AuditLog[]
}

function joinApproval(approval: MessageApproval, data: ScopedData, today: ISODate): ApprovalQueueItem | undefined {
  const communication = data.communications.find((c) => c.id === approval.communicationId)
  if (!communication) return undefined
  const users = indexById(data.users)
  const tenant = communication.tenantId ? data.tenants.find((t) => t.id === communication.tenantId) : undefined
  const owner = communication.ownerUserId ? users.get(communication.ownerUserId) : undefined
  const template = communication.templateId ? data.templates.find((t) => t.id === communication.templateId) : undefined
  const lease = communication.leaseId ? data.leases.find((l) => l.id === communication.leaseId) : undefined
  const tenantLease = tenant ? data.leases.find((l) => l.tenantId === tenant.id && (l.status === 'active' || l.status === 'expiring')) : undefined
  const propertyId = communication.propertyId ?? lease?.propertyId ?? tenantLease?.propertyId
  const property = propertyId ? data.properties.find((p) => p.id === propertyId) : undefined
  const requestedBy = users.get(approval.requestedByUserId)
  const eligibility: EligibilityResult = tenant
    ? canSendTenantMessage(tenant, communication.messageType, {
        settings: { requireApprovalForTenantMessages: false },
        arrangements: data.arrangements,
        today,
      })
    : { eligible: true, reasons: [] }
  return {
    approval,
    communication,
    ...(tenant ? { tenant } : {}),
    ...(owner ? { owner } : {}),
    ...(template ? { template } : {}),
    ...(property ? { property } : {}),
    ...(requestedBy ? { requestedBy } : {}),
    eligibility,
  }
}

export function buildApprovalQueue(data: ScopedData, today: ISODate): ApprovalQueueItem[] {
  return data.approvals
    .filter((a) => a.decision === 'pending')
    .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt))
    .map((a) => joinApproval(a, data, today))
    .filter((x): x is ApprovalQueueItem => x !== undefined)
}

/** Pending approvals of the active company, oldest first, with message/tenant/template context. */
export function listApprovalQueue(today: ISODate = todayISO()): ApprovalQueueItem[] {
  return buildApprovalQueue(getScopedData(), today)
}

/** Decided approvals (most recent first), joined the same way. */
export function listApprovalHistory(today: ISODate = todayISO()): ApprovalQueueItem[] {
  const data = getScopedData()
  return data.approvals
    .filter((a) => a.decision !== 'pending')
    .sort((a, b) => (b.decidedAt ?? b.requestedAt).localeCompare(a.decidedAt ?? a.requestedAt))
    .map((a) => joinApproval(a, data, today))
    .filter((x): x is ApprovalQueueItem => x !== undefined)
}

export function getApprovalDetails(approvalId: EntityId, today: ISODate = todayISO()): ApprovalDetails | undefined {
  const data = getScopedData()
  const approval = data.approvals.find((a) => a.id === approvalId)
  if (!approval) return undefined
  const item = joinApproval(approval, data, today)
  if (!item) return undefined
  const history = data.auditLogs
    .filter(
      (l) =>
        (l.entityType === 'message_approval' && l.entityId === approval.id) ||
        (l.entityType === 'communication' && l.entityId === approval.communicationId),
    )
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
  return { ...item, history }
}

function requirePending(approvalId: EntityId): MessageApproval {
  const approval = approvalsRepo.require(approvalId)
  if (approval.decision !== 'pending') throw new Error(`Approval ${approvalId} was already ${approval.decision}`)
  return approval
}

/** Approve by approval id; delegates to communications.approveMessage (message moves to `queued`). */
export function approveApproval(approvalId: EntityId, reason?: string): Communication {
  return approveMessage(requirePending(approvalId).communicationId, reason)
}

/** Reject by approval id; delegates to communications.rejectMessage. A reason is required. */
export function rejectApproval(approvalId: EntityId, reason: string): Communication {
  return rejectMessage(requirePending(approvalId).communicationId, reason)
}

// Hooks --------------------------------------------------------------------

export function useApprovalQueue(today: ISODate = todayISO()): ApprovalQueueItem[] {
  const data = useScopedData()
  return useMemo(() => buildApprovalQueue(data, today), [data, today])
}

export function useApprovalDetails(approvalId: EntityId | undefined, today: ISODate = todayISO()): ApprovalQueueItem | undefined {
  const data = useScopedData()
  return useMemo(() => {
    const approval = approvalId ? data.approvals.find((a) => a.id === approvalId) : undefined
    return approval ? joinApproval(approval, data, today) : undefined
  }, [data, approvalId, today])
}
