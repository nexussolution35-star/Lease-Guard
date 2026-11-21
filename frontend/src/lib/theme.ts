import { useSyncExternalStore } from 'react'

import { onBrowserPreferenceChange, readBrowserPreference, writeBrowserPreference } from './browserStorage'
import { useMediaQuery } from './useMediaQuery'

/** User theme preference. `system` follows `prefers-color-scheme` (no `data-theme` attribute). */
export type ThemePreference = 'light' | 'dark' | 'system'

/** Read by the inline script in `index.html` too, which applies a stored choice before first paint. */
export const THEME_STORAGE_KEY = 'leaseguard.theme'
export const THEME_PREFERENCES: readonly ThemePreference[] = ['light', 'dark', 'system']

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system'
}

/** `system` is the absence of a stored choice; anything unrecognised reads as `system` too. */
function parseStored(value: string | null): ThemePreference {
  return value === 'light' || value === 'dark' ? value : 'system'
}

let current: ThemePreference = typeof window === 'undefined' ? 'system' : parseStored(readBrowserPreference(THEME_STORAGE_KEY))
const listeners = new Set<() => void>()
let stopWatchingOtherTabs: (() => void) | null = null

/** The page background per theme, for the browser chrome. Keep equal to `--background` in `styles/globals.css`. */
const THEME_COLOR_LIGHT = '#f9fafb'
const THEME_COLOR_DARK = '#0b1016'

/**
 * Write the preference onto `<html data-theme>` and `<meta name="color-scheme">`; `system` removes the attribute
 * and restores `light dark`. The two media-keyed `theme-color` metas of `index.html` follow: a chosen theme sets
 * both, `system` restores each one's own colour.
 */
export function applyTheme(theme: ThemePreference): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (theme === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme)
  const scheme = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]')
  if (scheme) scheme.content = theme === 'system' ? 'light dark' : theme
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const own = meta.media.includes('dark') ? THEME_COLOR_DARK : THEME_COLOR_LIGHT
    meta.content = theme === 'system' ? own : theme === 'dark' ? THEME_COLOR_DARK : THEME_COLOR_LIGHT
  }
}

export function getThemePreference(): ThemePreference {
  return current
}

function update(theme: ThemePreference): void {
  current = theme
  applyTheme(theme)
  for (const listener of listeners) listener()
}

/**
 * Choose a theme. It applies at once everywhere that reads it (the account menu and Settings → Preferences) and
 * is remembered in this browser; `system` removes the stored choice. If storage is unavailable the choice still
 * applies for this session.
 */
export function setThemePreference(theme: ThemePreference): void {
  writeBrowserPreference(THEME_STORAGE_KEY, theme === 'system' ? null : theme)
  update(theme)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  // A choice made in another tab applies here too.
  stopWatchingOtherTabs ??= onBrowserPreferenceChange(THEME_STORAGE_KEY, (value) => update(parseStored(value)))
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && stopWatchingOtherTabs) {
      stopWatchingOtherTabs()
      stopWatchingOtherTabs = null
    }
  }
}

export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribe, getThemePreference, () => 'system')
}

/** The operating system's colour scheme right now, so "System" can say what it currently resolves to. */
export function useSystemColorScheme(): 'light' | 'dark' {
  return useMediaQuery('(prefers-color-scheme: dark)') ? 'dark' : 'light'
}

/** Apply the stored preference at startup (called once from the app entry). */
export function initTheme(): void {
  applyTheme(current)
}
