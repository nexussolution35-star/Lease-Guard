import type { AuditLogEntry } from './api/source'

type AuditValue = NonNullable<AuditLogEntry['changes']>[number]['before']

/** A before/after value as the audit log shows it: nothing recorded reads "empty", booleans read Yes/No. */
export function formatAuditValue(value: AuditValue): string {
  if (value === null || value === '') return 'empty'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return String(value)
}

/** A changed field's name for people: `monthly_rental` and `monthlyRental` both read "Monthly rental". */
export function formatAuditField(field: string): string {
  const words = field
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_.]+/g, ' ')
    .trim()
    .toLowerCase()
  return words === '' ? field : words.charAt(0).toUpperCase() + words.slice(1)
}
