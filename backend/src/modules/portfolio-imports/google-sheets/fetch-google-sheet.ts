import { googleSheetsCsvExportUrl, PORTFOLIO_IMPORT_MAX_FILE_BYTES, type GoogleSheetSource } from '@leaseguard/domain'

/** Why a Google Sheet could not be read. */
export type GoogleSheetErrorKind = 'not_shared' | 'not_found' | 'too_large' | 'timeout' | 'unavailable'

/** A Google Sheet LeaseGuard could not read; `message` is written for the person who pasted the link. */
export class GoogleSheetError extends Error {
  constructor(
    readonly kind: GoogleSheetErrorKind,
    message: string,
  ) {
    super(message)
    this.name = 'GoogleSheetError'
  }
}

/** The CSV Google exported for the sheet, and the file name Google gave it. */
export interface FetchedGoogleSheet {
  bytes: Buffer
  fileName: string
}

export interface FetchGoogleSheetOptions {
  /** Replaceable in tests. */
  fetch?: typeof globalThis.fetch
  /** The whole fetch, redirects and body included. */
  timeoutMs?: number
  maxBytes?: number
}

export const GOOGLE_SHEET_TIMEOUT_MS = 20_000
const MAX_REDIRECTS = 3
const FALLBACK_FILE_NAME = 'Google Sheet.csv'

export const NOT_SHARED_MESSAGE =
  'LeaseGuard cannot open this sheet: it is not shared with "Anyone with the link". In Google Sheets choose Share, ' +
  'under General access choose "Anyone with the link" with the Viewer role, then paste the link again. You can turn ' +
  'sharing off once the import has been created.'
export const NOT_FOUND_MESSAGE =
  'There is no Google Sheet at this link, or the tab in the link was deleted. Open the sheet in your browser and copy ' +
  'its link again from the address bar.'

/**
 * Google answers the export address on docs.google.com with a redirect to a download host under googleusercontent.com.
 * Only those two are followed; a redirect to accounts.google.com is Google asking to sign in (the sheet is not shared).
 */
const isDownloadHost = (host: string) => host === 'docs.google.com' || /^[a-z0-9-]+\.googleusercontent\.com$/.test(host)
const isSignInHost = (host: string) => host === 'accounts.google.com'

/**
 * Reads a Google Sheet as CSV from the export address LeaseGuard builds itself (`googleSheetsCsvExportUrl`), never an
 * address from the person's link. Redirects are followed by hand, only over HTTPS to Google's download hosts, at most
 * three times; the whole read is bounded in time and the body in size. Throws `GoogleSheetError` with a message for the
 * person: not shared with "Anyone with the link", no such sheet or tab, too large, too slow, or Google unavailable.
 */
export async function fetchGoogleSheet(source: GoogleSheetSource, options: FetchGoogleSheetOptions = {}): Promise<FetchedGoogleSheet> {
  const fetchImpl = options.fetch ?? globalThis.fetch
  const maxBytes = options.maxBytes ?? PORTFOLIO_IMPORT_MAX_FILE_BYTES
  const signal = AbortSignal.timeout(options.timeoutMs ?? GOOGLE_SHEET_TIMEOUT_MS)

  try {
    let url = new URL(googleSheetsCsvExportUrl(source))
    for (let hop = 0; ; hop++) {
      const response = await fetchImpl(url, { redirect: 'manual', signal, headers: { accept: 'text/csv' } })
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel()
        url = nextHop(url, response.headers.get('location'), hop)
        continue
      }
      if (response.status === 401 || response.status === 403) throw new GoogleSheetError('not_shared', NOT_SHARED_MESSAGE)
      if (response.status === 404 || response.status === 400 || response.status === 410) throw new GoogleSheetError('not_found', NOT_FOUND_MESSAGE)
      if (!response.ok) throw unavailable()
      // A sheet that needs a sign-in can also come back as Google's HTML sign-in page.
      if (/^text\/html/i.test(response.headers.get('content-type') ?? '')) {
        await response.body?.cancel()
        throw new GoogleSheetError('not_shared', NOT_SHARED_MESSAGE)
      }
      const bytes = await readBounded(response, maxBytes)
      return { bytes, fileName: csvFileName(response.headers.get('content-disposition')) }
    }
  } catch (error) {
    if (error instanceof GoogleSheetError) throw error
    if (signal.aborted) {
      throw new GoogleSheetError('timeout', 'Google Sheets took too long to send the sheet. Try again in a moment, or download it as CSV and upload the file.')
    }
    throw unavailable()
  }
}

const unavailable = () =>
  new GoogleSheetError('unavailable', 'Google Sheets could not be reached. Try again in a moment, or download the sheet as CSV and upload the file.')

const tooLarge = (maxBytes: number) =>
  new GoogleSheetError(
    'too_large',
    `The sheet is larger than the ${maxBytes / 1024 / 1024} MB limit for portfolio files. Split it into smaller sheets and import them one by one.`,
  )

/** The next address of a redirect, refused unless it stays on Google's download hosts over HTTPS. */
function nextHop(current: URL, location: string | null, hop: number): URL {
  if (!location || hop >= MAX_REDIRECTS) throw unavailable()
  let next: URL
  try {
    next = new URL(location, current)
  } catch {
    throw unavailable()
  }
  if (next.protocol === 'https:' && isSignInHost(next.hostname)) throw new GoogleSheetError('not_shared', NOT_SHARED_MESSAGE)
  if (next.protocol !== 'https:' || next.port !== '' || next.username !== '' || next.password !== '' || !isDownloadHost(next.hostname)) {
    throw unavailable()
  }
  // Google sends people who must sign in to a login page on the same host.
  if (/\/(ServiceLogin|signin)\b/i.test(next.pathname)) throw new GoogleSheetError('not_shared', NOT_SHARED_MESSAGE)
  return next
}

/** The body, refused as soon as it is larger than `maxBytes` (whatever Content-Length says). */
async function readBounded(response: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel()
    throw tooLarge(maxBytes)
  }
  if (!response.body) return Buffer.alloc(0)
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw tooLarge(maxBytes)
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks, total)
}

/**
 * The file name Google gives the export ("<spreadsheet> - <tab>.csv"), from `filename*` (UTF-8) or `filename`; a
 * fallback when there is none. Always ends in .csv and fits the 255 characters a batch's file name may have.
 */
export function csvFileName(contentDisposition: string | null): string {
  if (!contentDisposition) return FALLBACK_FILE_NAME
  let name: string | undefined
  const extended = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(contentDisposition)?.[1]
  if (extended) {
    try {
      name = decodeURIComponent(extended.trim())
    } catch {
      name = undefined
    }
  }
  name ??= /filename\s*=\s*"([^"]*)"/i.exec(contentDisposition)?.[1] ?? /filename\s*=\s*([^;]+)/i.exec(contentDisposition)?.[1]
  const cleaned = name
    ?.split('')
    .map((char) => (char < ' ' || char === '\u007f' || char === '/' || char === '\\' ? ' ' : char))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return FALLBACK_FILE_NAME
  const stem = cleaned.replace(/\.csv$/i, '').slice(0, 251).trim()
  return stem ? `${stem}.csv` : FALLBACK_FILE_NAME
}
