import { Logger } from '@nestjs/common'
import type { AuditLog, AuditScalar, FieldChange } from '@leaseguard/domain'
import { z } from 'zod'

import type { Json, Tables } from '../../infrastructure/database/database.types'

export type AuditLogRow = Tables<'audit_logs'>

/** An audit log entry as the API returns it: the domain `AuditLog` (no actor for background-job actions). */
export type AuditLogEntry = AuditLog

const logger = new Logger('AuditLogMapper')

const jsonValue: z.ZodType<Json> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(jsonValue), z.record(z.string(), jsonValue)]),
)
const changesSchema = z.array(z.object({ field: z.string(), before: jsonValue, after: jsonValue }))

/** Scalars pass through; arrays and objects (e.g. an array column) become their JSON text. */
function toScalar(value: Json): AuditScalar {
  return value === null || typeof value !== 'object' ? value : JSON.stringify(value)
}

/**
 * The `changes` jsonb column as `FieldChange[]`. Rows written by members may hold any JSON array, so
 * the shape is checked; an entry that does not match is reported in the log and the changes are left
 * out instead of being guessed.
 */
function toChanges(row: AuditLogRow): FieldChange[] | undefined {
  if (row.changes === null) return undefined
  const parsed = changesSchema.safeParse(row.changes)
  if (!parsed.success) {
    logger.warn(`Audit log ${row.id} has changes in an unexpected shape; changes omitted`)
    return undefined
  }
  return parsed.data.map((change) => ({ field: change.field, before: toScalar(change.before), after: toScalar(change.after) }))
}

/** Database row → `AuditLogEntry`. Nullable columns become absent optional fields. */
export function toAuditLogEntry(row: AuditLogRow): AuditLogEntry {
  const changes = toChanges(row)
  return {
    id: row.id,
    companyId: row.company_id,
    ...(row.actor_user_id ? { actorUserId: row.actor_user_id } : {}),
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    summary: row.summary,
    ...(changes ? { changes } : {}),
    occurredAt: row.occurred_at,
    createdAt: row.created_at,
    // Audit entries are append-only and never updated.
    updatedAt: row.created_at,
  }
}
