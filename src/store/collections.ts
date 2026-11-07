import type {
  AuditLog,
  Communication,
  Company,
  EntityId,
  Lease,
  LeaseDocument,
  MessageApproval,
  MessageTemplate,
  MonitoringEvent,
  MonitoringRule,
  Notification,
  PaymentArrangement,
  Property,
  Statement,
  StatementExtraction,
  Tenant,
  Unit,
  User,
} from '@/types'

/** Normalised record map keyed by entity id. */
export type RecordMap<T> = Readonly<Record<EntityId, T>>

/**
 * Every persisted entity collection. Both the demo seed (`src/data`) and the live store
 * (`src/store`) use exactly this shape, so reset-demo-data is a simple replacement.
 */
export interface Collections {
  companies: RecordMap<Company>
  users: RecordMap<User>
  properties: RecordMap<Property>
  units: RecordMap<Unit>
  tenants: RecordMap<Tenant>
  leases: RecordMap<Lease>
  leaseDocuments: RecordMap<LeaseDocument>
  statements: RecordMap<Statement>
  statementExtractions: RecordMap<StatementExtraction>
  monitoringEvents: RecordMap<MonitoringEvent>
  monitoringRules: RecordMap<MonitoringRule>
  paymentArrangements: RecordMap<PaymentArrangement>
  communications: RecordMap<Communication>
  messageTemplates: RecordMap<MessageTemplate>
  messageApprovals: RecordMap<MessageApproval>
  notifications: RecordMap<Notification>
  auditLogs: RecordMap<AuditLog>
}

export type CollectionKey = keyof Collections
export type CollectionEntity<K extends CollectionKey> = Collections[K][EntityId]

export const COLLECTION_KEYS: readonly CollectionKey[] = [
  'companies',
  'users',
  'properties',
  'units',
  'tenants',
  'leases',
  'leaseDocuments',
  'statements',
  'statementExtractions',
  'monitoringEvents',
  'monitoringRules',
  'paymentArrangements',
  'communications',
  'messageTemplates',
  'messageApprovals',
  'notifications',
  'auditLogs',
]

export function emptyCollections(): Collections {
  return {
    companies: {},
    users: {},
    properties: {},
    units: {},
    tenants: {},
    leases: {},
    leaseDocuments: {},
    statements: {},
    statementExtractions: {},
    monitoringEvents: {},
    monitoringRules: {},
    paymentArrangements: {},
    communications: {},
    messageTemplates: {},
    messageApprovals: {},
    notifications: {},
    auditLogs: {},
  }
}

/** Build a RecordMap from an array, failing loudly on duplicate ids. */
export function toRecordMap<T extends { id: EntityId }>(items: readonly T[]): RecordMap<T> {
  const map: Record<EntityId, T> = {}
  for (const item of items) {
    if (map[item.id]) throw new Error(`Duplicate id in collection: ${item.id}`)
    map[item.id] = item
  }
  return map
}
