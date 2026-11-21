import {
  DEFAULT_DATE_DISPLAY_FORMAT,
  formatDisplayDate,
  formatDisplayDateTime,
  isDateDisplayFormat,
  type DateDisplayFormat,
  type ISODate,
  type ISODateTime,
} from '@leaseguard/domain'
import { useMemo, useSyncExternalStore } from 'react'

import { onBrowserPreferenceChange, readBrowserPreference, writeBrowserPreference } from './browserStorage'

/**
 * The web app's one date formatter. Every date the app displays (lists, details, timelines, captions, toasts,
 * screen-reader text) goes through `useDateFormatter` or `DateDisplay`, in the format chosen in Settings →
 * Preferences and remembered in this browser. Display only: stored values and API payloads stay ISO, and tenant
 * messages and audit text keep the en-ZA default (`formatSADate`).
 */

export const DATE_FORMAT_STORAGE_KEY = 'leaseguard.dateFormat'

/** The default is the absence of a stored choice; anything unrecognised reads as the default too. */
function parseStored(value: string | null): DateDisplayFormat {
  return isDateDisplayFormat(value) ? value : DEFAULT_DATE_DISPLAY_FORMAT
}

let current: DateDisplayFormat = typeof window === 'undefined' ? DEFAULT_DATE_DISPLAY_FORMAT : parseStored(readBrowserPreference(DATE_FORMAT_STORAGE_KEY))
const listeners = new Set<() => void>()
let stopWatchingOtherTabs: (() => void) | null = null

export function getDateFormatPreference(): DateDisplayFormat {
  return current
}

function update(next: DateDisplayFormat): void {
  if (next === current) return
  current = next
  for (const listener of listeners) listener()
}

/**
 * Choose the display format. Every displayed date changes at once and the choice is remembered in this browser;
 * the default removes the stored choice. If storage is unavailable it still applies for this session.
 */
export function setDateFormatPreference(next: DateDisplayFormat): void {
  writeBrowserPreference(DATE_FORMAT_STORAGE_KEY, next === DEFAULT_DATE_DISPLAY_FORMAT ? null : next)
  update(next)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  stopWatchingOtherTabs ??= onBrowserPreferenceChange(DATE_FORMAT_STORAGE_KEY, (value) => update(parseStored(value)))
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && stopWatchingOtherTabs) {
      stopWatchingOtherTabs()
      stopWatchingOtherTabs = null
    }
  }
}

export function useDateFormatPreference(): DateDisplayFormat {
  return useSyncExternalStore(subscribe, getDateFormatPreference, () => DEFAULT_DATE_DISPLAY_FORMAT)
}

export interface DateFormatter {
  /** A calendar date, e.g. `21 Nov 2026`. */
  date: (iso: ISODate) => string
  /** A timestamp's date and wall-clock time, e.g. `21 Nov 2026, 08:30`. */
  dateTime: (iso: ISODateTime) => string
  /** The chosen format. */
  format: DateDisplayFormat
}

/** The shared formatter in the chosen format; the component re-renders when the choice changes. */
export function useDateFormatter(): DateFormatter {
  const format = useDateFormatPreference()
  return useMemo(
    () => ({
      date: (iso: ISODate) => formatDisplayDate(iso, format),
      dateTime: (iso: ISODateTime) => formatDisplayDateTime(iso, format),
      format,
    }),
    [format],
  )
}
