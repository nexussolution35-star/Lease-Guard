import { useSyncExternalStore } from 'react'

import { onBrowserPreferenceChange, readBrowserPreference, writeBrowserPreference } from './browserStorage'
import { useMediaQuery } from './useMediaQuery'

/**
 * Motion preference. `system` follows `prefers-reduced-motion` (no `data-motion` attribute); `reduce` and `full`
 * set `<html data-motion>`, which the app's `motion-reduce:` / `motion-safe:` variants (redefined in
 * `styles/globals.css`) honour, so every component follows without its own code.
 */
export type MotionPreference = 'system' | 'reduce' | 'full'

/** Read by the inline script in `index.html` too, which applies a stored choice before first paint. */
export const MOTION_STORAGE_KEY = 'leaseguard.motion'
export const MOTION_PREFERENCES: readonly MotionPreference[] = ['system', 'reduce', 'full']
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

export function isMotionPreference(value: unknown): value is MotionPreference {
  return value === 'system' || value === 'reduce' || value === 'full'
}

function parseStored(value: string | null): MotionPreference {
  return value === 'reduce' || value === 'full' ? value : 'system'
}

let current: MotionPreference = typeof window === 'undefined' ? 'system' : parseStored(readBrowserPreference(MOTION_STORAGE_KEY))
const listeners = new Set<() => void>()
let stopWatchingOtherTabs: (() => void) | null = null

/** Write the preference onto `<html data-motion>`; `system` removes the attribute. */
export function applyMotion(motion: MotionPreference): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (motion === 'system') root.removeAttribute('data-motion')
  else root.setAttribute('data-motion', motion)
}

export function getMotionPreference(): MotionPreference {
  return current
}

function update(next: MotionPreference): void {
  current = next
  applyMotion(next)
  for (const listener of listeners) listener()
}

/** Choose motion. It applies at once and is remembered in this browser; `system` removes the stored choice. */
export function setMotionPreference(next: MotionPreference): void {
  writeBrowserPreference(MOTION_STORAGE_KEY, next === 'system' ? null : next)
  update(next)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  stopWatchingOtherTabs ??= onBrowserPreferenceChange(MOTION_STORAGE_KEY, (value) => update(parseStored(value)))
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && stopWatchingOtherTabs) {
      stopWatchingOtherTabs()
      stopWatchingOtherTabs = null
    }
  }
}

export function useMotionPreference(): MotionPreference {
  return useSyncExternalStore(subscribe, getMotionPreference, () => 'system')
}

/** Whether the device asks for reduced motion right now, so "System" can say what it resolves to. */
export function useSystemReducedMotion(): boolean {
  return useMediaQuery(REDUCED_MOTION_QUERY)
}

/** Whether motion is reduced right now, preference and system together (for motion started from script). */
export function isMotionReduced(): boolean {
  if (current !== 'system') return current === 'reduce'
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(REDUCED_MOTION_QUERY).matches
}

/** Apply the stored preference at startup (called once from the app entry). */
export function initMotion(): void {
  applyMotion(current)
}
