import type { EntityId } from '@leaseguard/domain'

/**
 * Object path convention enforced by supabase/migrations/*_storage.sql for the statement and lease
 * document buckets: `<company_id>/<entity_id>/<file name>`. The first segment decides access (storage
 * policies), and table rows holding the path are CHECK-constrained to start with their company id.
 */

/** Lowercase canonical uuid, exactly as `private.storage_company_id` accepts it. */
const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
/** A file segment produced by `storageFileName`: safe ASCII, no leading dot or dash. */
const FILE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/

export const MAX_STORAGE_FILE_NAME_LENGTH = 120
const FALLBACK_FILE_NAME = 'document'

export interface StorageObjectLocation {
  companyId: EntityId
  entityId: EntityId
  fileName: string
}

/**
 * The object-key form of a user-supplied file name: accents removed, anything other than letters,
 * digits, `.`, `_` and `-` replaced by `-`, and trimmed to 120 characters with the extension kept.
 * Storage keys must not contain `/`, so a name can never add path segments.
 */
export function storageFileName(original: string): string {
  const ascii = original.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  const cleaned = ascii
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/-+\./g, '.')
    .replace(/^[-.]+/, '')
    .replace(/[-.]+$/, '')
  if (!cleaned) return FALLBACK_FILE_NAME
  if (cleaned.length <= MAX_STORAGE_FILE_NAME_LENGTH) return cleaned

  const dot = cleaned.lastIndexOf('.')
  const extension = dot > 0 && cleaned.length - dot <= 10 ? cleaned.slice(dot) : ''
  const stem = cleaned.slice(0, MAX_STORAGE_FILE_NAME_LENGTH - extension.length).replace(/[-.]+$/, '')
  return `${stem || FALLBACK_FILE_NAME}${extension}`
}

/** `<company_id>/<entity_id>/<safe file name>`. Ids must be lowercase uuids. */
export function storageObjectPath(companyId: EntityId, entityId: EntityId, fileName: string): string {
  if (!UUID_SEGMENT.test(companyId)) throw new Error(`Storage path company id must be a lowercase uuid: ${companyId}`)
  if (!UUID_SEGMENT.test(entityId)) throw new Error(`Storage path entity id must be a lowercase uuid: ${entityId}`)
  return `${companyId}/${entityId}/${storageFileName(fileName)}`
}

/** Splits a path that follows the convention exactly; `null` for anything else. */
export function parseStorageObjectPath(path: string): StorageObjectLocation | null {
  const segments = path.split('/')
  if (segments.length !== 3) return null
  const [companyId, entityId, fileName] = segments
  if (companyId === undefined || entityId === undefined || fileName === undefined) return null
  if (!UUID_SEGMENT.test(companyId) || !UUID_SEGMENT.test(entityId) || !FILE_SEGMENT.test(fileName)) return null
  return { companyId, entityId, fileName }
}
