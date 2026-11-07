/**
 * Typed service contracts. UI code depends on these shapes (via `services` in registry.ts), so a
 * future API-backed implementation can replace the local Zustand-backed one without UI changes.
 * Only plain (non-hook) functions are part of the contracts; hooks stay module exports.
 */
import type { EligibilityResult } from '@/domain/communicationEligibility'
import type { DuplicateMatch } from '@/domain/statementDuplicates'
import type {
  AuditLog,
  Communication,
  DashboardMetrics,
  EntityId,
  EntityType,
  ISODate,
  Lease,
  LeaseDocument,
  MessageApproval,
  MessageTemplate,
  MessageType,
  MonitoringEvent,
  MonitoringEventStatus,
  MonitoringRule,
  Notification,
  OwnerMessageType,
  PaymentArrangement,
  Property,
  RecipientType,
  ReportDefinition,
  ReportFilters,
  ReportId,
  ReportResultMap,
  Statement,
  StatementExtraction,
  StoredFile,
  TemplateApprovalStatus,
  Tenant,
  TenantMessageType,
  Unit,
  WhatsAppAccountConfig,
} from '@/types'

import type { ApprovalDetails, ApprovalQueueItem } from '@/services/approvals'
import type { CreateArrangementInput, ReminderSuppressionStatus } from '@/services/arrangements'
import type { AuditEntryInput } from '@/services/audit'
import type { DeliveryUpdate, DraftResult, DraftTenantMessageOptions, InboundReplyInput, OutboundDeliveryStatus } from '@/services/communications'
import type { EventContext, LeaseContext, PropertyContext, TenantContext, UnitContext } from '@/services/context'
import type {
  BrowserFileInfo,
  FileNameMatch,
  ProcessingStep,
  SimulateExtractionOptions,
  SimulatedUploadInput,
  SimulatedUploadResult,
  UploadWithDuplicateCheckResult,
} from '@/services/extraction'
import type { AddLeaseDocumentInput, CreateLeaseInput, RenewLeaseInput } from '@/services/leases'
import type { EventCountsByType } from '@/services/monitoring'
import type { PushNotificationInput } from '@/services/notifications'
import type { PropertyWithStats } from '@/services/properties'
import type { ListQuery, PagedResult } from '@/services/query'
import type { CreateInput, MutationOptions, UpdateInput } from '@/services/repository'
import type { ConfirmExtractionInput, StatementFigures, UploadStatementInput } from '@/services/statements'
import type { CreateTemplateInput, TemplateValidation } from '@/services/templates'
import type { TenantSummary } from '@/services/tenants'
import type {
  AnswerOwnerQuestionOptions,
  ConversationSummary,
  OptOutStatus,
  OwnerAnswer,
  OwnerWeeklySummary,
  SimulatedReceipt,
  SuppressionStatus,
  WhatsAppChannelOverview,
  WhatsAppChannelSettings,
} from '@/services/whatsapp'

export interface PropertyService {
  list(query?: ListQuery<Property>): PagedResult<Property>
  listAll(): Property[]
  getById(id: EntityId | undefined): Property | undefined
  create(input: CreateInput<Property>, options?: MutationOptions): Property
  update(id: EntityId, patch: UpdateInput<Property>, options?: MutationOptions): Property
  archive(id: EntityId): Property
  getWithStats(id: EntityId): PropertyWithStats | undefined
  getContext(id: EntityId): PropertyContext | undefined
}

export interface UnitService {
  list(query?: ListQuery<Unit>): PagedResult<Unit>
  listAll(): Unit[]
  getById(id: EntityId | undefined): Unit | undefined
  create(input: CreateInput<Unit>, options?: MutationOptions): Unit
  update(id: EntityId, patch: UpdateInput<Unit>, options?: MutationOptions): Unit
  remove(id: EntityId, options?: MutationOptions): void
  listForProperty(propertyId: EntityId): Unit[]
  assignTenant(unitId: EntityId, tenantId: EntityId, leaseId: EntityId): Unit
  release(unitId: EntityId): Unit
  getContext(id: EntityId): UnitContext | undefined
}

export interface TenantService {
  list(query?: ListQuery<Tenant>): PagedResult<Tenant>
  listAll(): Tenant[]
  getById(id: EntityId | undefined): Tenant | undefined
  create(input: CreateInput<Tenant>, options?: MutationOptions): Tenant
  update(id: EntityId, patch: UpdateInput<Tenant>, options?: MutationOptions): Tenant
  markWhatsAppVerified(tenantId: EntityId, verified?: boolean): Tenant
  setOptOut(tenantId: EntityId, optedOut: boolean): Tenant
  getSummary(tenantId: EntityId): TenantSummary | undefined
  getContext(tenantId: EntityId, today?: ISODate): TenantContext | undefined
  /** Scoped to the tenant AND the active company. */
  getCommunicationHistory(tenantId: EntityId): Communication[]
}

export interface LeaseService {
  list(query?: ListQuery<Lease>): PagedResult<Lease>
  listAll(): Lease[]
  getById(id: EntityId | undefined): Lease | undefined
  create(input: CreateLeaseInput): Lease
  update(id: EntityId, patch: UpdateInput<Lease>, options?: MutationOptions): Lease
  verify(leaseId: EntityId): Lease
  terminate(leaseId: EntityId, notes?: string): Lease
  renew(leaseId: EntityId, input: RenewLeaseInput): Lease
  addDocument(input: AddLeaseDocumentInput): LeaseDocument
  listDocuments(leaseId: EntityId): LeaseDocument[]
  removeDocument(documentId: EntityId): void
  getContext(leaseId: EntityId): LeaseContext | undefined
}

export interface StatementService {
  list(query?: ListQuery<Statement>): PagedResult<Statement>
  listAll(): Statement[]
  getById(id: EntityId | undefined): Statement | undefined
  getExtraction(id: EntityId | undefined): StatementExtraction | undefined
  listForTenant(tenantId: EntityId): Statement[]
  findBySha256(sha256: string): Statement | undefined
  upload(input: UploadStatementInput): Statement
  uploadWithDuplicateCheck(input: UploadStatementInput): UploadWithDuplicateCheckResult
  uploadSimulated(input: SimulatedUploadInput, today?: ISODate): SimulatedUploadResult
  createSimulatedFile(file: BrowserFileInfo, companyId?: EntityId): StoredFile
  matchFile(fileName: string, propertyId?: EntityId): FileNameMatch
  simulateExtraction(statementId: EntityId, options?: SimulateExtractionOptions): StatementExtraction
  getProcessingSteps(statementId: EntityId): ProcessingStep[]
  figuresFromExtraction(extraction: StatementExtraction): StatementFigures
  confirmExtraction(statementId: EntityId, corrections?: ConfirmExtractionInput): Statement
  markDuplicate(statementId: EntityId, duplicateOfStatementId: EntityId): Statement
  reject(statementId: EntityId, reason: string): Statement
}

export interface MonitoringService {
  listEvents(query?: ListQuery<MonitoringEvent>): PagedResult<MonitoringEvent>
  listAllEvents(): MonitoringEvent[]
  getEvent(id: EntityId | undefined): MonitoringEvent | undefined
  createEvent(input: CreateInput<MonitoringEvent>, options?: MutationOptions): MonitoringEvent
  canTransition(from: MonitoringEventStatus, to: MonitoringEventStatus): boolean
  transitionEvent(eventId: EntityId, status: MonitoringEventStatus, notes?: string): MonitoringEvent
  assignEvent(eventId: EntityId, userId: EntityId | undefined): MonitoringEvent
  countOpenEventsByType(events: readonly MonitoringEvent[]): EventCountsByType
  /** Event with its source references: lease, statement (+ extraction), rule and related records. */
  getEventContext(eventId: EntityId): EventContext | undefined
  listRules(query?: ListQuery<MonitoringRule>): PagedResult<MonitoringRule>
  listAllRules(): MonitoringRule[]
  getRule(id: EntityId | undefined): MonitoringRule | undefined
  createRule(input: CreateInput<MonitoringRule>, options?: MutationOptions): MonitoringRule
  updateRule(id: EntityId, patch: UpdateInput<MonitoringRule>, options?: MutationOptions): MonitoringRule
  setRuleEnabled(ruleId: EntityId, enabled: boolean): MonitoringRule
}

export interface ArrangementService {
  list(query?: ListQuery<PaymentArrangement>): PagedResult<PaymentArrangement>
  listAll(): PaymentArrangement[]
  getById(id: EntityId | undefined): PaymentArrangement | undefined
  create(input: CreateArrangementInput): PaymentArrangement
  activate(arrangementId: EntityId, agreedOn?: ISODate): PaymentArrangement
  close(arrangementId: EntityId, status: 'completed' | 'defaulted' | 'cancelled', notes?: string): PaymentArrangement
  confirmInstallment(arrangementId: EntityId, installmentId: EntityId, confirmedOn?: ISODate): PaymentArrangement
  markInstallmentMissed(arrangementId: EntityId, installmentId: EntityId, notes?: string): PaymentArrangement
  markInstallmentReminderSent(arrangementId: EntityId, installmentId: EntityId): PaymentArrangement
  getActiveForTenant(tenantId: EntityId): PaymentArrangement | undefined
  getReminderSuppressionStatus(tenantId: EntityId, today?: ISODate): ReminderSuppressionStatus
}

export interface CommunicationService {
  list(query?: ListQuery<Communication>): PagedResult<Communication>
  getById(id: EntityId | undefined): Communication | undefined
  draftTenantMessage(type: TenantMessageType, tenantId: EntityId, body: string, options?: DraftTenantMessageOptions): DraftResult
  draftOwnerMessage(type: OwnerMessageType, ownerUserId: EntityId, body: string, propertyId?: EntityId): Communication
  recordDeliveryStatus(communicationId: EntityId, status: OutboundDeliveryStatus, update?: DeliveryUpdate): Communication
  recordInboundReply(input: InboundReplyInput): Communication
  /** Tenant conversation, active company only, oldest first. */
  listConversation(tenantId: EntityId): Communication[]
  assertTenantMessageType(type: string): TenantMessageType
  assertNoBankDetails(body: string): void
}

export interface MessageApprovalService {
  /** Pending approvals joined with communication, tenant/owner, template and eligibility. */
  listPendingApprovals(today?: ISODate): ApprovalQueueItem[]
  listHistory(today?: ISODate): ApprovalQueueItem[]
  getApproval(id: EntityId | undefined): MessageApproval | undefined
  getApprovalDetails(approvalId: EntityId, today?: ISODate): ApprovalDetails | undefined
  approve(approvalId: EntityId, reason?: string): Communication
  reject(approvalId: EntityId, reason: string): Communication
}

export interface MessageTemplateService {
  list(query?: ListQuery<MessageTemplate>): PagedResult<MessageTemplate>
  listAll(): MessageTemplate[]
  listTenantTemplates(type?: MessageType): MessageTemplate[]
  getById(id: EntityId | undefined): MessageTemplate | undefined
  create(input: CreateTemplateInput): MessageTemplate
  update(id: EntityId, patch: UpdateInput<MessageTemplate>): MessageTemplate
  remove(id: EntityId): void
  submitForApproval(id: EntityId): MessageTemplate
  recordDecision(id: EntityId, decision: Extract<TemplateApprovalStatus, 'approved' | 'rejected'>): MessageTemplate
  renderTemplate(template: Pick<MessageTemplate, 'body' | 'variables' | 'audience'>, variables: Record<string, string>): string
  validateTemplateBody(body: string, audience: RecipientType): TemplateValidation
}

export interface WhatsAppBusinessService {
  getChannel(): WhatsAppChannelOverview
  updateChannelSettings(patch: WhatsAppChannelSettings): WhatsAppAccountConfig
  simulateConnectionCheck(): WhatsAppAccountConfig
  sendApprovedMessage(communicationId: EntityId, today?: ISODate): Communication
  simulateDeliveryProgress(communicationId: EntityId, to: SimulatedReceipt, reason?: string): Communication
  retryFailedMessage(communicationId: EntityId): Communication
  getSendAttempts(communicationId: EntityId): number
  listConversations(): ConversationSummary[]
  getConversationThread(key: string): Communication[]
  getOptOutStatus(tenantId: EntityId): OptOutStatus
  getSuppressionStatus(tenantId: EntityId, messageType: MessageType, today?: ISODate): SuppressionStatus
  buildOwnerWeeklySummary(ownerUserId: EntityId, today?: ISODate): OwnerWeeklySummary
  answerOwnerQuestion(question: string, ownerUserId: EntityId, today?: ISODate, options?: AnswerOwnerQuestionOptions): OwnerAnswer
}

export interface NotificationService {
  listForCurrentUser(): Notification[]
  getUnreadCount(): number
  markRead(notificationId: EntityId): Notification | undefined
  markAllRead(): number
  push(input: PushNotificationInput): Notification
  remove(notificationId: EntityId): void
}

export interface ReportService {
  definitions: readonly ReportDefinition[]
  getReport<K extends ReportId>(id: K, filters?: ReportFilters, today?: ISODate): ReportResultMap[K]
  portfolioOverview(filters?: ReportFilters, today?: ISODate): ReportResultMap['portfolio_overview']
  occupancy(filters?: ReportFilters, today?: ISODate): ReportResultMap['occupancy']
  leaseMonitoring(filters?: ReportFilters, today?: ISODate): ReportResultMap['lease_monitoring']
  rentalDiscrepancies(filters?: ReportFilters, today?: ISODate): ReportResultMap['rental_discrepancies']
  leaseExpiry(filters?: ReportFilters, today?: ISODate): ReportResultMap['lease_expiry']
  renewalDeadlines(filters?: ReportFilters, today?: ISODate): ReportResultMap['renewal_deadlines']
  depositsAndGuarantees(filters?: ReportFilters, today?: ISODate): ReportResultMap['deposits_guarantees']
  arrears(filters?: ReportFilters, today?: ISODate): ReportResultMap['arrears']
  paymentArrangements(filters?: ReportFilters, today?: ISODate): ReportResultMap['payment_arrangements']
  statementProcessing(filters?: ReportFilters, today?: ISODate): ReportResultMap['statement_processing']
  communicationActivity(filters?: ReportFilters, today?: ISODate): ReportResultMap['communication_activity']
  getDashboardMetrics(today?: ISODate): DashboardMetrics
}

export interface AuditService {
  list(query?: ListQuery<AuditLog>): PagedResult<AuditLog>
  listForEntity(entityType: EntityType, entityId: EntityId): AuditLog[]
  record(entry: AuditEntryInput): AuditLog
}

export interface Services {
  properties: PropertyService
  units: UnitService
  tenants: TenantService
  leases: LeaseService
  statements: StatementService
  monitoring: MonitoringService
  arrangements: ArrangementService
  communications: CommunicationService
  approvals: MessageApprovalService
  templates: MessageTemplateService
  whatsapp: WhatsAppBusinessService
  notifications: NotificationService
  reports: ReportService
  audit: AuditService
}

/** Re-exported for contract consumers. */
export type { DuplicateMatch, EligibilityResult }
