/**
 * Concrete, store-backed implementations of the service contracts. UI code may call
 * `services.leases.verify(id)` etc.; swapping in an API-backed implementation means providing
 * objects that satisfy the same interfaces.
 */
import {
  approveApproval,
  getApprovalDetails,
  listApprovalHistory,
  listApprovalQueue,
  rejectApproval,
} from '@/services/approvals'
import {
  activateArrangement,
  closeArrangement,
  confirmInstallment,
  createArrangement,
  getActiveArrangementForTenant,
  getArrangement,
  getReminderSuppressionStatus,
  listAllArrangements,
  listArrangements,
  markInstallmentMissed,
  markInstallmentReminderSent,
} from '@/services/arrangements'
import { listAudit, listAuditForEntity, recordAudit } from '@/services/audit'
import {
  assertNoBankDetails,
  assertTenantMessageType,
  draftOwnerMessage,
  draftTenantMessage,
  getApproval,
  getCommunication,
  getTemplate,
  listAllTemplates,
  listCommunications,
  listConversation,
  listTemplates,
  listTenantTemplates,
  recordDeliveryStatus,
  recordInboundReply,
} from '@/services/communications'
import {
  getEventContext,
  getLeaseContext,
  getPropertyContext,
  getTenantCommunicationHistory,
  getTenantContext,
  getUnitContext,
} from '@/services/context'
import type {
  ArrangementService,
  AuditService,
  CommunicationService,
  LeaseService,
  MessageApprovalService,
  MessageTemplateService,
  MonitoringService,
  NotificationService,
  PropertyService,
  ReportService,
  Services,
  StatementService,
  TenantService,
  UnitService,
  WhatsAppBusinessService,
} from '@/services/contracts'
import {
  createSimulatedFile,
  matchStatementFile,
  simulateExtraction,
  simulateProcessingSteps,
  uploadSimulatedStatement,
  uploadStatementWithDuplicateCheck,
} from '@/services/extraction'
import {
  addLeaseDocument,
  createLease,
  getLease,
  listAllLeases,
  listLeaseDocuments,
  listLeases,
  removeLeaseDocument,
  renewLease,
  terminateLease,
  updateLease,
  verifyLease,
} from '@/services/leases'
import {
  assignEvent,
  canTransition,
  countOpenEventsByType,
  createEvent,
  createRule,
  getEvent,
  getRule,
  listAllEvents,
  listAllRules,
  listEvents,
  listRules,
  setRuleEnabled,
  transitionEvent,
  updateRule,
} from '@/services/monitoring'
import { getUnreadCount, listForCurrentUser, markAllRead, markRead, pushNotification, removeNotification } from '@/services/notifications'
import {
  archiveProperty,
  createProperty,
  getProperty,
  getPropertyWithStats,
  listAllProperties,
  listProperties,
  updateProperty,
} from '@/services/properties'
import {
  getArrearsReport,
  getCommunicationActivityReport,
  getDashboardMetrics,
  getDepositsGuaranteesReport,
  getLeaseExpiryReport,
  getLeaseMonitoringReport,
  getOccupancyReport,
  getPaymentArrangementsReport,
  getPortfolioOverview,
  getRenewalDeadlinesReport,
  getRentalDiscrepancyReport,
  getReport,
  getStatementProcessingReport,
  REPORT_DEFINITIONS,
} from '@/services/reports'
import {
  confirmExtraction,
  figuresFromExtraction,
  findStatementBySha256,
  getExtraction,
  getStatement,
  listAllStatements,
  listStatements,
  listStatementsForTenant,
  markDuplicate,
  rejectStatement,
  uploadStatement,
} from '@/services/statements'
import {
  createMessageTemplate,
  deleteMessageTemplate,
  recordTemplateDecision,
  renderTemplate,
  submitTemplateForApproval,
  updateMessageTemplate,
  validateTemplateBody,
} from '@/services/templates'
import {
  createTenant,
  getTenant,
  getTenantSummary,
  listAllTenants,
  listTenants,
  markWhatsAppVerified,
  setOptOut,
  updateTenant,
} from '@/services/tenants'
import { assignTenant, createUnit, getUnit, listAllUnits, listUnits, listUnitsForProperty, releaseUnit, removeUnit, updateUnit } from '@/services/units'
import {
  answerOwnerQuestion,
  buildOwnerWeeklySummary,
  getChannel,
  getConversationThread,
  getOptOutStatus,
  getSendAttempts,
  getSuppressionStatus,
  listConversations,
  retryFailedMessage,
  sendApprovedMessage,
  simulateConnectionCheck,
  simulateDeliveryProgress,
  updateChannelSettings,
} from '@/services/whatsapp'

export const propertyService = {
  list: listProperties,
  listAll: listAllProperties,
  getById: getProperty,
  create: createProperty,
  update: updateProperty,
  archive: archiveProperty,
  getWithStats: getPropertyWithStats,
  getContext: getPropertyContext,
} satisfies PropertyService

export const unitService = {
  list: listUnits,
  listAll: listAllUnits,
  getById: getUnit,
  create: createUnit,
  update: updateUnit,
  remove: removeUnit,
  listForProperty: listUnitsForProperty,
  assignTenant,
  release: releaseUnit,
  getContext: getUnitContext,
} satisfies UnitService

export const tenantService = {
  list: listTenants,
  listAll: listAllTenants,
  getById: getTenant,
  create: createTenant,
  update: updateTenant,
  markWhatsAppVerified,
  setOptOut,
  getSummary: getTenantSummary,
  getContext: getTenantContext,
  getCommunicationHistory: getTenantCommunicationHistory,
} satisfies TenantService

export const leaseService = {
  list: listLeases,
  listAll: listAllLeases,
  getById: getLease,
  create: createLease,
  update: updateLease,
  verify: verifyLease,
  terminate: terminateLease,
  renew: renewLease,
  addDocument: addLeaseDocument,
  listDocuments: listLeaseDocuments,
  removeDocument: removeLeaseDocument,
  getContext: getLeaseContext,
} satisfies LeaseService

export const statementService = {
  list: listStatements,
  listAll: listAllStatements,
  getById: getStatement,
  getExtraction,
  listForTenant: listStatementsForTenant,
  findBySha256: findStatementBySha256,
  upload: uploadStatement,
  uploadWithDuplicateCheck: uploadStatementWithDuplicateCheck,
  uploadSimulated: uploadSimulatedStatement,
  createSimulatedFile,
  matchFile: matchStatementFile,
  simulateExtraction,
  getProcessingSteps: simulateProcessingSteps,
  figuresFromExtraction,
  confirmExtraction,
  markDuplicate,
  reject: rejectStatement,
} satisfies StatementService

export const monitoringService = {
  listEvents,
  listAllEvents,
  getEvent,
  createEvent,
  canTransition,
  transitionEvent,
  assignEvent,
  countOpenEventsByType,
  getEventContext,
  listRules,
  listAllRules,
  getRule,
  createRule,
  updateRule,
  setRuleEnabled,
} satisfies MonitoringService

export const arrangementService = {
  list: listArrangements,
  listAll: listAllArrangements,
  getById: getArrangement,
  create: createArrangement,
  activate: activateArrangement,
  close: closeArrangement,
  confirmInstallment,
  markInstallmentMissed,
  markInstallmentReminderSent,
  getActiveForTenant: getActiveArrangementForTenant,
  getReminderSuppressionStatus,
} satisfies ArrangementService

export const communicationService = {
  list: listCommunications,
  getById: getCommunication,
  draftTenantMessage,
  draftOwnerMessage,
  recordDeliveryStatus,
  recordInboundReply,
  listConversation,
  assertTenantMessageType,
  assertNoBankDetails,
} satisfies CommunicationService

export const messageApprovalService = {
  listPendingApprovals: listApprovalQueue,
  listHistory: listApprovalHistory,
  getApproval,
  getApprovalDetails,
  approve: approveApproval,
  reject: rejectApproval,
} satisfies MessageApprovalService

export const messageTemplateService = {
  list: listTemplates,
  listAll: listAllTemplates,
  listTenantTemplates,
  getById: getTemplate,
  create: createMessageTemplate,
  update: updateMessageTemplate,
  remove: deleteMessageTemplate,
  submitForApproval: submitTemplateForApproval,
  recordDecision: recordTemplateDecision,
  renderTemplate,
  validateTemplateBody,
} satisfies MessageTemplateService

export const whatsAppBusinessService = {
  getChannel,
  updateChannelSettings,
  simulateConnectionCheck,
  sendApprovedMessage,
  simulateDeliveryProgress,
  retryFailedMessage,
  getSendAttempts,
  listConversations,
  getConversationThread,
  getOptOutStatus,
  getSuppressionStatus,
  buildOwnerWeeklySummary,
  answerOwnerQuestion,
} satisfies WhatsAppBusinessService

export const notificationService = {
  listForCurrentUser,
  getUnreadCount,
  markRead,
  markAllRead,
  push: pushNotification,
  remove: removeNotification,
} satisfies NotificationService

export const reportService: ReportService = {
  definitions: REPORT_DEFINITIONS,
  getReport,
  portfolioOverview: getPortfolioOverview,
  occupancy: getOccupancyReport,
  leaseMonitoring: getLeaseMonitoringReport,
  rentalDiscrepancies: getRentalDiscrepancyReport,
  leaseExpiry: getLeaseExpiryReport,
  renewalDeadlines: getRenewalDeadlinesReport,
  depositsAndGuarantees: getDepositsGuaranteesReport,
  arrears: getArrearsReport,
  paymentArrangements: getPaymentArrangementsReport,
  statementProcessing: getStatementProcessingReport,
  communicationActivity: getCommunicationActivityReport,
  getDashboardMetrics,
}

export const auditService = {
  list: listAudit,
  listForEntity: listAuditForEntity,
  record: recordAudit,
} satisfies AuditService

/** Every service, typed against its contract. */
export const services: Services = {
  properties: propertyService,
  units: unitService,
  tenants: tenantService,
  leases: leaseService,
  statements: statementService,
  monitoring: monitoringService,
  arrangements: arrangementService,
  communications: communicationService,
  approvals: messageApprovalService,
  templates: messageTemplateService,
  whatsapp: whatsAppBusinessService,
  notifications: notificationService,
  reports: reportService,
  audit: auditService,
}
