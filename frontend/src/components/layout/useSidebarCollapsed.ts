import { useSyncExternalStore } from 'react'

import { onBrowserPreferenceChange, readBrowserPreference, writeBrowserPreference } from '@/lib/browserStorage'

export const SIDEBAR_COLLAPSED_STORAGE_KEY = 'leaseguard.sidebarCollapsed'

let collapsed = typeof window === 'undefined' ? false : readBrowserPreference(SIDEBAR_COLLAPSED_STORAGE_KEY) === 'true'
const listeners = new Set<() => void>()
let stopWatchingOtherTabs: (() => void) | null = null

function update(next: boolean): void {
  collapsed = next
  for (const listener of listeners) listener()
}

export function getSidebarCollapsed(): boolean {
  return collapsed
}

/**
 * Retract (icon rail) or expand the desktop sidebar. It applies at once, and the sidebar starts that way on the
 * next load in this browser. If storage is unavailable the state still applies for this session.
 */
export function setSidebarCollapsed(next: boolean): void {
  writeBrowserPreference(SIDEBAR_COLLAPSED_STORAGE_KEY, String(next))
  update(next)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  stopWatchingOtherTabs ??= onBrowserPreferenceChange(SIDEBAR_COLLAPSED_STORAGE_KEY, (value) => update(value === 'true'))
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && stopWatchingOtherTabs) {
      stopWatchingOtherTabs()
      stopWatchingOtherTabs = null
    }
  }
}

/**
 * Desktop sidebar collapsed (icon rail) state, persisted per browser. One shared state: the sidebar's own toggle
 * and Settings → Preferences change the same value.
 */
export function useSidebarCollapsed(): [boolean, () => void] {
  const value = useSyncExternalStore(subscribe, getSidebarCollapsed, () => false)
  return [value, toggleSidebarCollapsed]
}

function toggleSidebarCollapsed(): void {
  setSidebarCollapsed(!collapsed)
}
