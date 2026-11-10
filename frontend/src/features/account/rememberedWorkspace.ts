import type { EntityId } from '@leaseguard/domain'

/**
 * The workspace a user last opened on this browser, so a reload or the next sign-in reopens
 * it. A per-browser convenience only: it is validated against the user's memberships from `/me`
 * before use, and losing it (private window, cleared storage) just falls back to the default
 * membership. Never holds anything but a company id.
 */
const KEY_PREFIX = 'leaseguard.api.workspace.'

type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>

function browserStorage(): KeyValueStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function readRememberedWorkspace(userId: string, storage: KeyValueStorage | null = browserStorage()): EntityId | null {
  if (!storage || userId === '') return null
  try {
    const value = storage.getItem(KEY_PREFIX + userId)
    return value && value.trim() !== '' ? value : null
  } catch {
    return null
  }
}

export function rememberWorkspace(userId: string, companyId: EntityId, storage: KeyValueStorage | null = browserStorage()): void {
  if (!storage || userId === '') return
  try {
    storage.setItem(KEY_PREFIX + userId, companyId)
  } catch {
    // Storage full or blocked: the workspace is simply not remembered.
  }
}
