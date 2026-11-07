import type { FieldErrors, FieldValues } from 'react-hook-form'

export interface FlatFieldError {
  /** Dotted RHF path, e.g. `escalation.percentage` or `charges.0.amount`. */
  path: string
  message: string
}

const META_KEYS = new Set(['message', 'type', 'ref', 'types'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Flatten RHF `FieldErrors` (nested objects / arrays) or a plain `{ path: message }` record
 * into a list of `{ path, message }` in declaration order. A `root` key (RHF form-level or
 * array-level error) maps to its parent path (or `root` at top level).
 */
export function flattenErrors(
  errors: FieldErrors<FieldValues> | Record<string, string> | null | undefined,
): FlatFieldError[] {
  const out: FlatFieldError[] = []
  const visit = (node: unknown, path: string) => {
    if (typeof node === 'string') {
      if (node) out.push({ path, message: node })
      return
    }
    if (!isRecord(node)) return
    if (typeof node.message === 'string' && node.message !== '') {
      out.push({ path, message: node.message })
    }
    for (const [key, child] of Object.entries(node)) {
      if (META_KEYS.has(key)) continue
      if (key === 'root') {
        visit(child, path || 'root')
        continue
      }
      visit(child, path ? `${path}.${key}` : key)
    }
  }
  if (errors) {
    for (const [key, child] of Object.entries(errors)) visit(child, key)
  }
  return out
}
