import { describe, expect, it, vi } from 'vitest'

import { csvFileName, fetchGoogleSheet, GoogleSheetError, NOT_FOUND_MESSAGE, NOT_SHARED_MESSAGE } from './fetch-google-sheet'

const ID = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms'
const EXPORT = `https://docs.google.com/spreadsheets/d/${ID}/export?format=csv`
const DOWNLOAD = `https://doc-08-4o-sheets.googleusercontent.com/export/abc/def/1/2/*/${ID}?format=csv&gid=7`
const CSV = 'Property code,Property name\r\nMSQ,Market Square\r\n'

const redirect = (location: string, status = 307) => new Response(null, { status, headers: { location } })
const csv = (body: string | ReadableStream<Uint8Array> = CSV, headers: Record<string, string> = {}) =>
  new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="RentRoll-Units.csv"; filename*=UTF-8''Rent%20roll%20-%20Units.csv`,
      ...headers,
    },
  })

/** A fake network answering each address in turn; records what was asked for. */
function network(...answers: Response[]) {
  return vi.fn<typeof globalThis.fetch>(async () => {
    const next = answers.shift()
    if (!next) throw new Error('unexpected request')
    return next
  })
}
const requested = (fetch: ReturnType<typeof network>) => fetch.mock.calls.map(([url]) => String(url))

async function refusal(promise: Promise<unknown>): Promise<GoogleSheetError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  )
  expect(error).toBeInstanceOf(GoogleSheetError)
  return error as GoogleSheetError
}

describe('fetchGoogleSheet', () => {
  it('reads the first tab from the export address it builds, following Google to its download host', async () => {
    const fetch = network(redirect(DOWNLOAD), csv())
    const sheet = await fetchGoogleSheet({ spreadsheetId: ID }, { fetch })
    expect(requested(fetch)).toEqual([EXPORT, DOWNLOAD])
    expect(fetch.mock.calls[0]![1]).toMatchObject({ redirect: 'manual' })
    expect(sheet.bytes.toString('utf8')).toBe(CSV)
    expect(sheet.fileName).toBe('Rent roll - Units.csv')
  })

  it('reads the tab named in the link', async () => {
    const fetch = network(csv())
    await fetchGoogleSheet({ spreadsheetId: ID, gid: '1386834576' }, { fetch })
    expect(requested(fetch)).toEqual([`${EXPORT}&gid=1386834576`])
  })

  it('says how to share a sheet that needs a sign-in', async () => {
    for (const answers of [
      [redirect('https://accounts.google.com/ServiceLogin?continue=x', 302)],
      [redirect('https://docs.google.com/a/example.com/ServiceLogin?x', 302)],
      [new Response('denied', { status: 401 })],
      [new Response('denied', { status: 403 })],
      [redirect(DOWNLOAD), new Response('<html>Sign in</html>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })],
    ]) {
      const error = await refusal(fetchGoogleSheet({ spreadsheetId: ID }, { fetch: network(...answers) }))
      expect(error.kind).toBe('not_shared')
      expect(error.message).toBe(NOT_SHARED_MESSAGE)
    }
    expect(NOT_SHARED_MESSAGE).toMatch(/Share.*"Anyone with the link".*Viewer/)
  })

  it('says when there is no sheet or tab at the link', async () => {
    const error = await refusal(fetchGoogleSheet({ spreadsheetId: ID }, { fetch: network(new Response('Not found', { status: 404 })) }))
    expect(error).toMatchObject({ kind: 'not_found', message: NOT_FOUND_MESSAGE })
    const badTab = await refusal(fetchGoogleSheet({ spreadsheetId: ID, gid: '9' }, { fetch: network(redirect(DOWNLOAD), new Response('', { status: 400 })) }))
    expect(badTab.kind).toBe('not_found')
  })

  it('never follows a redirect off Google, over plain HTTP, to another port or more than three times', async () => {
    for (const location of [
      'https://evil.example/export.csv',
      'http://doc-08-4o-sheets.googleusercontent.com/export',
      'https://doc-08-4o-sheets.googleusercontent.com:8443/export',
      'https://googleusercontent.com.evil.example/export',
      'https://user:pw@docs.google.com/export',
      'http://169.254.169.254/latest/meta-data',
    ]) {
      const fetch = network(redirect(location))
      const error = await refusal(fetchGoogleSheet({ spreadsheetId: ID }, { fetch }))
      expect(error.kind, location).toBe('unavailable')
      expect(fetch).toHaveBeenCalledTimes(1)
    }
    const loop = network(redirect(DOWNLOAD), redirect(DOWNLOAD), redirect(DOWNLOAD), redirect(DOWNLOAD), csv())
    expect((await refusal(fetchGoogleSheet({ spreadsheetId: ID }, { fetch: loop }))).kind).toBe('unavailable')
    expect(loop).toHaveBeenCalledTimes(4)
  })

  it('refuses an oversized sheet by its declared length or while reading it', async () => {
    const declared = await refusal(
      fetchGoogleSheet({ spreadsheetId: ID }, { fetch: network(csv('x', { 'content-length': String(6 * 1024 * 1024) })) }),
    )
    expect(declared).toMatchObject({ kind: 'too_large' })
    expect(declared.message).toMatch(/larger than the 5 MB limit/)

    let pulled = 0
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++
        controller.enqueue(new Uint8Array(64 * 1024).fill(0x41))
      },
    })
    const streamed = await refusal(fetchGoogleSheet({ spreadsheetId: ID }, { fetch: network(csv(endless)), maxBytes: 1024 * 1024 }))
    expect(streamed.kind).toBe('too_large')
    expect(pulled).toBeLessThan(40)
  })

  it('gives up when Google is too slow, and reports Google failures plainly', async () => {
    const hanging = vi.fn<typeof globalThis.fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
        }),
    )
    expect((await refusal(fetchGoogleSheet({ spreadsheetId: ID }, { fetch: hanging, timeoutMs: 20 }))).kind).toBe('timeout')
    expect((await refusal(fetchGoogleSheet({ spreadsheetId: ID }, { fetch: network(new Response('', { status: 503 })) }))).kind).toBe('unavailable')
    const offline = vi.fn<typeof globalThis.fetch>(async () => {
      throw new TypeError('fetch failed')
    })
    expect((await refusal(fetchGoogleSheet({ spreadsheetId: ID }, { fetch: offline }))).kind).toBe('unavailable')
  })
})

describe('csvFileName', () => {
  it('uses the UTF-8 name, then the plain one, then a fallback; always a .csv name of at most 255 characters', () => {
    expect(csvFileName(`attachment; filename="a.csv"; filename*=UTF-8''Huurrol%20%E2%80%93%20Eenhede.csv`)).toBe('Huurrol – Eenhede.csv')
    expect(csvFileName('attachment; filename="Rent roll.csv"')).toBe('Rent roll.csv')
    expect(csvFileName('attachment; filename="../../etc/passwd"')).toBe('.. .. etc passwd.csv')
    expect(csvFileName(null)).toBe('Google Sheet.csv')
    expect(csvFileName('attachment')).toBe('Google Sheet.csv')
    const long = csvFileName(`attachment; filename="${'x'.repeat(400)}.csv"`)
    expect(long).toHaveLength(255)
    expect(long.endsWith('.csv')).toBe(true)
  })
})
