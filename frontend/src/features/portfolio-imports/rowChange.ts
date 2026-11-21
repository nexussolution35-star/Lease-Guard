import type { PortfolioImportFieldKey, PortfolioImportRowChange, PortfolioImportRowCheck } from '@leaseguard/domain'

/** What a row's field reads now: the manager's correction, else the file's cell ('' when empty or not mapped). */
export function currentImportValue(row: PortfolioImportRowCheck, field: PortfolioImportFieldKey): string {
  return row.values[field] ?? ''
}

/** The file's own cell for a field, whatever the manager corrected ('' when empty or not mapped). */
export function fileImportValue(row: PortfolioImportRowCheck, field: PortfolioImportFieldKey): string {
  const correction = row.resolution?.corrections.find((entry) => entry.field === field)
  return correction ? (correction.fileValue ?? '') : (row.values[field] ?? '')
}

/**
 * The corrections to send for an edited row: only fields whose value changed; a value typed back to the file's cell
 * drops the correction (null) so the file is read again. Undefined when nothing changed.
 */
export function correctionsFromDraft(
  row: PortfolioImportRowCheck,
  fields: readonly PortfolioImportFieldKey[],
  draft: Partial<Record<PortfolioImportFieldKey, string>>,
): PortfolioImportRowChange['corrections'] {
  const corrections: NonNullable<PortfolioImportRowChange['corrections']> = {}
  for (const field of fields) {
    const typed = draft[field]
    if (typed === undefined) continue
    const value = typed.trim()
    if (value === currentImportValue(row, field)) continue
    corrections[field] = value === fileImportValue(row, field) ? null : value
  }
  return Object.keys(corrections).length > 0 ? corrections : undefined
}
