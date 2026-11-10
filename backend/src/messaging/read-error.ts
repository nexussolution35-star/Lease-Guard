/**
 * A read the messaging module needed failed (database or channel lookup unreachable); retrying may
 * succeed. Callers translate it at their edge: the API into its HTTP error, the worker by retrying the
 * job. Never carries row data or a token.
 */
export class MessagingReadError extends Error {
  readonly operation: string
  /** The PostgREST / Postgres error, in the shape `httpErrorFromDatabase` reads. */
  readonly databaseError: { readonly code: string; readonly message: string }

  constructor(operation: string, error: { code: string; message: string }) {
    super(`${operation} failed (${error.code}): ${error.message}`)
    this.name = 'MessagingReadError'
    this.operation = operation
    this.databaseError = { code: error.code, message: error.message }
  }
}

/** Returns `data` (or `fallback` for null), or throws MessagingReadError. */
export function readOrThrow<T, F>(result: { data: T | null; error: { code: string; message: string } | null }, operation: string, fallback: F): T | F {
  if (result.error) throw new MessagingReadError(operation, result.error)
  return result.data ?? fallback
}
