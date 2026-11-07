import { useMemo } from 'react'

import { isTenantMessageType } from '@leaseguard/domain'
import { findBankDetails } from '@leaseguard/domain'
import { nowISO } from '@/store/ids'
import {
  type Communication,
  type DeliveryStatus,
  type EntityId,
  type MessageApproval,
  type MessageType,
  type OwnerMessageType,
  type StoredFile,
  type TenantMessageType,
} from '@leaseguard/domain'

import { getActiveCompany } from '@/services/companies'
import type { ListQuery, PagedResult } from '@/services/query'
import { createRepository, getCurrentUserId } from '@/services/repository'
import { tenantsRepo } from '@/services/tenants'
import { getUserById } from '@/services/users'

export const communicationsRepo = createRepository('communications', {
  entityType: 'communication',
  label: 'Message',
  idPrefix: 'msg',
  searchFields: ['body', 'counterpartyNumber'],
})

export const templatesRepo = createRepository('messageTemplates', {
  entityType: 'message_template',
  label: 'Message template',
  idPrefix: 'tpl',
  searchFields: ['name', 'body', 'metaTemplateName'],
})

export const approvalsRepo = createRepository('messageApprovals', {
  entityType: 'message_approval',
  label: 'Message approval',
  idPrefix: 'apr',
})

export const listCommunications = communicationsRepo.list
export const getCommunication = communicationsRepo.getById
export const listTemplates = templatesRepo.list
export const listAllTemplates = templatesRepo.listAll
export const getTemplate = templatesRepo.getById
export const createTemplate = templatesRepo.create
export const updateTemplate = templatesRepo.update
export const listApprovals = approvalsRepo.list
export const getApproval = approvalsRepo.getById

export class ForbiddenTenantMessageError extends Error {
  readonly messageType: string
  constructor(messageType: string) {
    super(
      `Message type "${messageType}" may not be sent to tenants. Tenants only receive statements and payment reminders.`,
    )
    this.name = 'ForbiddenTenantMessageError'
    this.messageType = messageType
  }
}

export { isTenantMessageType }

export class BankDetailsInMessageError extends Error {
  readonly fragments: readonly string[]
  constructor(fragments: readonly string[]) {
    super(
      `Messages may not contain banking details; LeaseGuard never collects or facilitates payments (found ${fragments
        .map((f) => `"${f}"`)
        .join(', ')})`,
    )
    this.name = 'BankDetailsInMessageError'
    this.fragments = fragments
  }
}

/** Throws BankDetailsInMessageError when `body` contains account numbers, branch codes, IBANs or banking-detail wording. */
export function assertNoBankDetails(body: string): void {
  const found = findBankDetails(body)
  if (found.length > 0) throw new BankDetailsInMessageError(found.map((f) => f.text))
}

/** Product rule (enforced by `@/domain`): tenants only ever receive statement and payment-related messages. */
export function assertTenantMessageType(type: string): TenantMessageType {
  if (!isTenantMessageType(type)) throw new ForbiddenTenantMessageError(type)
  return type
}

export interface DraftTenantMessageOptions {
  attachment?: StoredFile
  templateId?: EntityId
  statementId?: EntityId
  arrangementId?: EntityId
  leaseId?: EntityId
  propertyId?: EntityId
}

export interface DraftResult {
  communication: Communication
  /** Present when the company requires approval before sending. */
  approval?: MessageApproval
}

/**
 * Draft an outbound WhatsApp message to a tenant. Throws for any non-tenant message type.
 * When the company requires approval the message waits as `pending_approval` with a pending
 * MessageApproval; otherwise it is `approved` and ready for the sending queue.
 */
export function draftTenantMessage(
  type: TenantMessageType,
  tenantId: EntityId,
  body: string,
  options: DraftTenantMessageOptions = {},
): DraftResult {
  const messageType = assertTenantMessageType(type)
  assertNoBankDetails(body)
  const tenant = tenantsRepo.require(tenantId)
  if (tenant.whatsappOptedOut) throw new Error(`Tenant ${tenant.tradingName} has opted out of WhatsApp messages`)
  const company = getActiveCompany()
  const requiresApproval = company.settings.requireApprovalForTenantMessages
  const actor = getCurrentUserId()

  const communication = communicationsRepo.create(
    {
      channel: 'whatsapp',
      direction: 'outbound',
      messageType,
      recipientType: 'tenant',
      tenantId,
      counterpartyNumber: tenant.whatsappNumber,
      companyNumber: company.whatsapp.displayNumber,
      body,
      status: requiresApproval ? 'pending_approval' : 'approved',
      createdByUserId: actor,
      ...(options.attachment ? { attachment: options.attachment } : {}),
      ...(options.templateId ? { templateId: options.templateId } : {}),
      ...(options.statementId ? { statementId: options.statementId } : {}),
      ...(options.arrangementId ? { arrangementId: options.arrangementId } : {}),
      ...(options.leaseId ? { leaseId: options.leaseId } : {}),
      ...(options.propertyId ? { propertyId: options.propertyId } : {}),
    },
    { summary: `${messageType.replace(/_/g, ' ')} drafted for ${tenant.tradingName}` },
  )

  if (!requiresApproval) return { communication }

  const approval = approvalsRepo.create(
    {
      communicationId: communication.id,
      requestedByUserId: actor,
      requestedAt: nowISO(),
      decision: 'pending',
    },
    { summary: `Approval requested for message to ${tenant.tradingName}` },
  )
  const withApproval = communicationsRepo.update(communication.id, { approvalId: approval.id }, { summary: 'Approval linked to message' })
  return { communication: withApproval, approval }
}

/** Draft an outbound message to a property owner (weekly summary or query response). */
export function draftOwnerMessage(type: OwnerMessageType, ownerUserId: EntityId, body: string, propertyId?: EntityId): Communication {
  const owner = getUserById(ownerUserId)
  if (!owner) throw new Error(`Owner user ${ownerUserId} not found`)
  if (!owner.whatsappNumber) throw new Error(`Owner ${owner.fullName} has no WhatsApp number`)
  const company = getActiveCompany()
  return communicationsRepo.create(
    {
      channel: 'whatsapp',
      direction: 'outbound',
      messageType: type,
      recipientType: 'property_owner',
      ownerUserId,
      counterpartyNumber: owner.whatsappNumber,
      companyNumber: company.whatsapp.displayNumber,
      body,
      status: 'approved',
      createdByUserId: getCurrentUserId(),
      ...(propertyId ? { propertyId } : {}),
    },
    { summary: `${type.replace(/_/g, ' ')} drafted for ${owner.fullName}` },
  )
}

function pendingApprovalFor(communicationId: EntityId): MessageApproval {
  const communication = communicationsRepo.require(communicationId)
  const approval = communication.approvalId ? approvalsRepo.getById(communication.approvalId) : undefined
  if (!approval) throw new Error(`Message ${communicationId} has no approval request`)
  if (approval.decision !== 'pending') throw new Error(`Message ${communicationId} was already ${approval.decision}`)
  return approval
}

/** Approve a pending tenant message; it moves to `queued` for sending. */
export function approveMessage(communicationId: EntityId, reason?: string): Communication {
  const approval = pendingApprovalFor(communicationId)
  approvalsRepo.update(
    approval.id,
    { decision: 'approved', decidedByUserId: getCurrentUserId(), decidedAt: nowISO(), ...(reason !== undefined ? { reason } : {}) },
    { action: 'approve', summary: 'Message approved' },
  )
  return communicationsRepo.update(communicationId, { status: 'queued' }, { action: 'approve', summary: 'Message approved and queued' })
}

export function rejectMessage(communicationId: EntityId, reason: string): Communication {
  const approval = pendingApprovalFor(communicationId)
  if (!reason.trim()) throw new Error('A reason is required to reject a message')
  approvalsRepo.update(
    approval.id,
    { decision: 'rejected', decidedByUserId: getCurrentUserId(), decidedAt: nowISO(), reason },
    { action: 'reject', summary: `Message rejected: ${reason}` },
  )
  return communicationsRepo.update(communicationId, { status: 'rejected' }, { action: 'reject', summary: `Message rejected: ${reason}` })
}

export type OutboundDeliveryStatus = Extract<DeliveryStatus, 'queued' | 'sent' | 'delivered' | 'read' | 'failed'>

export interface DeliveryUpdate {
  externalMessageId?: string
  failureReason?: string
  /** Defaults to now. */
  at?: string
}

/** Record a delivery status update (from the WhatsApp webhook or the demo simulator). */
export function recordDeliveryStatus(communicationId: EntityId, status: OutboundDeliveryStatus, update: DeliveryUpdate = {}): Communication {
  const communication = communicationsRepo.require(communicationId)
  if (communication.direction !== 'outbound') throw new Error('Delivery status applies to outbound messages only')
  if (communication.status === 'pending_approval' || communication.status === 'rejected' || communication.status === 'draft') {
    throw new Error(`Message ${communicationId} is ${communication.status} and cannot be ${status}`)
  }
  const at = update.at ?? nowISO()
  return communicationsRepo.update(
    communicationId,
    {
      status,
      ...(update.externalMessageId ? { externalMessageId: update.externalMessageId } : {}),
      ...(status === 'sent' ? { sentAt: at } : {}),
      ...(status === 'delivered' ? { deliveredAt: at, sentAt: communication.sentAt ?? at } : {}),
      ...(status === 'read' ? { readAt: at, deliveredAt: communication.deliveredAt ?? at, sentAt: communication.sentAt ?? at } : {}),
      ...(status === 'failed' ? { failureReason: update.failureReason ?? 'Delivery failed' } : {}),
    },
    { action: status === 'sent' ? 'send' : 'update', summary: `Message ${status}` },
  )
}

export interface InboundReplyInput {
  tenantId: EntityId
  body: string
  attachment?: StoredFile
  externalMessageId?: string
  receivedAt?: string
}

export function recordInboundReply(input: InboundReplyInput): Communication {
  const tenant = tenantsRepo.require(input.tenantId)
  const company = getActiveCompany()
  const at = input.receivedAt ?? nowISO()
  return communicationsRepo.create(
    {
      channel: 'whatsapp',
      direction: 'inbound',
      messageType: 'inbound_reply',
      recipientType: 'tenant',
      tenantId: tenant.id,
      counterpartyNumber: tenant.whatsappNumber,
      companyNumber: company.whatsapp.displayNumber,
      body: input.body,
      status: 'received',
      sentAt: at,
      deliveredAt: at,
      ...(input.attachment ? { attachment: input.attachment } : {}),
      ...(input.externalMessageId ? { externalMessageId: input.externalMessageId } : {}),
    },
    { summary: `Reply received from ${tenant.tradingName}` },
  )
}

export function messageTimestamp(c: Communication): string {
  return c.sentAt ?? c.createdAt
}

export function sortConversation(messages: readonly Communication[]): Communication[] {
  return [...messages].sort((a, b) => messageTimestamp(a).localeCompare(messageTimestamp(b)))
}

export function listConversation(tenantId: EntityId): Communication[] {
  return sortConversation(communicationsRepo.listAll().filter((c) => c.tenantId === tenantId))
}

export function listPendingApprovals(): MessageApproval[] {
  return approvalsRepo.listAll().filter((a) => a.decision === 'pending')
}

/** Tenant-facing templates only (audience = tenant); never exposes owner/internal topics as tenant templates. */
export function listTenantTemplates(type?: MessageType) {
  return templatesRepo.listAll().filter((t) => t.audience === 'tenant' && (type === undefined || t.messageType === type))
}

// Hooks --------------------------------------------------------------------

export function useCommunications(query?: ListQuery<Communication>): PagedResult<Communication> {
  return communicationsRepo.useList(query)
}

export const useCommunication = communicationsRepo.useById
export const useAllTemplates = templatesRepo.useAll
export const useTemplate = templatesRepo.useById

export function useConversation(tenantId: EntityId | undefined): Communication[] {
  const all = communicationsRepo.useAll()
  return useMemo(() => (tenantId ? sortConversation(all.filter((c) => c.tenantId === tenantId)) : []), [all, tenantId])
}

export function usePendingApprovals(): MessageApproval[] {
  const all = approvalsRepo.useAll()
  return useMemo(() => all.filter((a) => a.decision === 'pending'), [all])
}
