import type { GoogleSheetSource } from '../types/index.js'

/**
 * A Google Sheets link as a browser shows it: `https://docs.google.com/spreadsheets/d/<id>/edit#gid=<tab>`, optionally
 * with a `/u/<n>/` account segment, any further path, query or fragment. Only this host and path are accepted: no other
 * host, no port, no user name before the host. Published-to-the-web links (`/d/e/…`) are not spreadsheet ids and do
 * not match.
 */
const SHEETS_LINK = /^(?:https?:\/\/)?docs\.google\.com\/spreadsheets\/(?:u\/\d{1,2}\/)?d\/([A-Za-z0-9_-]{20,100})(?:[/?#]\S*)?$/i
/** The tab: `#gid=123` or `?gid=123` (or after `&`), as Google writes it. */
const TAB_ID = /[#?&]gid=(\d{1,12})(?!\d)/

/**
 * The spreadsheet and tab a Google Sheets link names, or null when the text is not a Google Sheets link. The tab is
 * absent when the link names none (the first tab is read).
 */
export function parseGoogleSheetsLink(text: string): GoogleSheetSource | null {
  const match = SHEETS_LINK.exec(text.trim())
  if (!match) return null
  const gid = TAB_ID.exec(match[0])?.[1]
  return { spreadsheetId: match[1]!, ...(gid !== undefined ? { gid } : {}) }
}

/**
 * The CSV export address of the sheet: the only address LeaseGuard fetches for a Google Sheets import. It is built from
 * the parsed id and tab, never taken from the link the person pasted.
 */
export function googleSheetsCsvExportUrl(source: GoogleSheetSource): string {
  const base = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(source.spreadsheetId)}/export?format=csv`
  return source.gid !== undefined ? `${base}&gid=${encodeURIComponent(source.gid)}` : base
}

/** The sheet's own link, to open it in Google Sheets. */
export function googleSheetUrl(source: GoogleSheetSource): string {
  const base = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(source.spreadsheetId)}/edit`
  return source.gid !== undefined ? `${base}#gid=${encodeURIComponent(source.gid)}` : base
}
