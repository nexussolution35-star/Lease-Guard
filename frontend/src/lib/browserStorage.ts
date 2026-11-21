/**
 * Viewer conveniences kept in this browser's `localStorage` (theme, sidebar state). Never business data.
 * Storage can be unavailable or throw (private mode, blocked site data): every access is guarded, so a
 * preference still applies for the session even when it cannot be remembered.
 */

/** The stored value, or `null` when there is none or storage cannot be read. */
export function readBrowserPreference(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

/** Store a value (`null` removes it). Returns whether the browser accepted it. */
export function writeBrowserPreference(key: string, value: string | null): boolean {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

const PROBE_KEY = 'leaseguard.storageProbe'

/** Whether this browser will remember preferences: storage exists and accepts a write. */
export function canRememberBrowserPreferences(): boolean {
  try {
    localStorage.setItem(PROBE_KEY, '1')
    localStorage.removeItem(PROBE_KEY)
    return true
  } catch {
    return false
  }
}

/** Run `onChange` when another tab changes `key` (the `storage` event never fires in the tab that wrote it). */
export function onBrowserPreferenceChange(key: string, onChange: (value: string | null) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const handler = (event: StorageEvent) => {
    // `key` is null when another tab cleared all storage.
    if (event.key === key || event.key === null) onChange(event.key === null ? null : event.newValue)
  }
  window.addEventListener('storage', handler)
  return () => window.removeEventListener('storage', handler)
}
