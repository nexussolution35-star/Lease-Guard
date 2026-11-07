import type { CompanyScoped, EntityId, EntityType, ISODateTime } from './common.js'

export const AUDIT_ACTIONS = [
  'create',
  'update',
  'archive',
  'delete',
  'verify',
  'approve',
  'reject',
  'upload',
  'send',
  'resolve',
  'dismiss',
  'login',
  'logout',
  'workspace_switch',
  'reset_demo_data',
] as const
export type AuditAction = (typeof AUDIT_ACTIONS)[number]

export type AuditScalar = string | number | boolean | null

export interface FieldChange {
  field: string
  before: AuditScalar
  after: AuditScalar
}

export interface AuditLog extends CompanyScoped {
  actorUserId: EntityId
  action: AuditAction
  entityType: EntityType
  entityId: EntityId
  summary: string
  changes?: readonly FieldChange[]
  occurredAt: ISODateTime
}
