import { useSyncExternalStore } from 'react'

/** User theme preference. `system` follows `prefers-color-scheme` (no `data-theme` attribute). */
export type ThemePreference = 'light' | 'dark' | 'system'

export const THEME_STORAGE_KEY = 'leaseguard.theme'
export const THEME_PREFERENCES: readonly ThemePreference[] = ['light', 'dark', 'system']

function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system'
}

function readStored(): ThemePreference {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY)
    return isThemePreference(value) ? value : 'system'
  } catch {
    return 'system'
  }
}

let current: ThemePreference = typeof window === 'undefined' ? 'system' : readStored()
const listeners = new Set<() => void>()

/** The page background per theme, for the browser chrome. Keep equal to `--background` in `styles/globals.css`. */
const THEME_COLOR_LIGHT = '#f9fafb'
const THEME_COLOR_DARK = '#0b1016'

/**
 * Write the preference onto `<html data-theme>`; `system` removes the attribute. The two media-keyed
 * `theme-color` metas of `index.html` follow: a chosen theme sets both, `system` restores each one's own colour.
 */
export function applyTheme(theme: ThemePreference): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (theme === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme)
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const own = meta.media.includes('dark') ? THEME_COLOR_DARK : THEME_COLOR_LIGHT
    meta.content = theme === 'system' ? own : theme === 'dark' ? THEME_COLOR_DARK : THEME_COLOR_LIGHT
  }
}

export function getThemePreference(): ThemePreference {
  return current
}

export function setThemePreference(theme: ThemePreference): void {
  current = theme
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // Storage may be unavailable (private mode); the preference still applies for this session.
  }
  applyTheme(theme)
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribe, getThemePreference, () => 'system')
}

/** Apply the stored preference at startup (called once from the app entry). */
export function initTheme(): void {
  applyTheme(current)
}
