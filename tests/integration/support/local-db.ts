import { localSql } from '../../fixtures/local-db.ts'

/** Tables whose rows the suite reads as whole-row snapshots. */
export type SnapshotTable = 'leases' | 'monitoring_events' | 'properties'

export type RowSnapshot = Readonly<Record<string, unknown>>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function assertUuid(id: string): void {
  if (!UUID.test(id)) throw new Error(`Not a lowercase uuid: ${id}`)
}

/** The complete row as JSON (`to_jsonb`), to prove a refused request changed nothing. */
export async function snapshotRow(table: SnapshotTable, id: string): Promise<RowSnapshot> {
  assertUuid(id)
  const rows = await localSql(`select to_jsonb(t) as row from public.${table} t where t.id = '${id}'`)
  const first = rows[0]
  if (rows.length !== 1 || typeof first !== 'object' || first === null || !('row' in first)) {
    throw new Error(`Expected exactly one ${table} row with id ${id}, found ${rows.length}`)
  }
  const row = first.row
  if (typeof row !== 'object' || row === null || Array.isArray(row)) throw new Error(`Unexpected ${table} snapshot`)
  return row as RowSnapshot
}

/** Number of audit_logs rows for one entity (audit logs are append-only). */
export async function auditCount(entityId: string): Promise<number> {
  assertUuid(entityId)
  const rows = await localSql(`select count(*)::int as n from public.audit_logs where entity_id = '${entityId}'`)
  const first = rows[0]
  if (typeof first !== 'object' || first === null || !('n' in first) || typeof first.n !== 'number') {
    throw new Error('Unexpected audit count result')
  }
  return first.n
}
