const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * API record ids are UUIDs (any version). A detail URL with another id shape (e.g. an old bookmark) cannot
 * exist in the API, so API sources answer "not found" without a request that would fail validation.
 */
export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value)
}
