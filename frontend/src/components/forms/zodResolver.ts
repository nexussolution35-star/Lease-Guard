import type { FieldError, FieldErrors, FieldValues, Resolver } from 'react-hook-form'
import type { z } from 'zod'

type ErrorTree = { [key: string]: ErrorTree | FieldError }

function setNested(tree: ErrorTree, path: readonly PropertyKey[], error: FieldError): void {
  const keys = path.length === 0 ? ['root'] : path.map(String)
  let node = tree
  for (const key of keys.slice(0, -1)) {
    const next = node[key]
    if (next === undefined || 'message' in next) {
      const child: ErrorTree = {}
      node[key] = child
      node = child
    } else {
      node = next as ErrorTree
    }
  }
  const leaf = keys[keys.length - 1] ?? 'root'
  // First issue per field wins, matching the order the schema reports them.
  if (node[leaf] === undefined) node[leaf] = error
}

/**
 * react-hook-form resolver for a zod schema (the project does not depend on @hookform/resolvers).
 * Validation messages come from the schema; errors are nested by path as react-hook-form expects.
 */
export function zodResolver<TSchema extends z.ZodType<FieldValues, FieldValues>>(
  schema: TSchema,
): Resolver<z.input<TSchema>, unknown, z.output<TSchema>> {
  return async (values) => {
    const result = await schema.safeParseAsync(values)
    if (result.success) return { values: result.data, errors: {} }
    const tree: ErrorTree = {}
    for (const issue of result.error.issues) {
      setNested(tree, issue.path, { type: issue.code, message: issue.message })
    }
    // The tree mirrors the form's field paths, which is exactly the FieldErrors shape.
    return { values: {}, errors: tree as FieldErrors<z.input<TSchema>> }
  }
}
