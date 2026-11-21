import { readFile } from 'node:fs/promises'

import { expect, test, type Page } from '@playwright/test'
import type { SupabaseClient } from '@supabase/supabase-js'

import { createReportsDataset, removeReportsDataset, saToday, type ReportsDataset } from '../fixtures/reports-acceptance.ts'
import { serviceRoleClient } from '../fixtures/world.ts'
import { pageHeading, signIn } from './support/app.ts'
import { e2eContext, e2eUser, e2eWorld } from './support/world.ts'

/**
 * Reports acceptance (ticket R-08) in the browser, on the real stack: the web app calls the Vite dev server's gateway,
 * which sends /api/v1/reports to the reports service (run-api.ts starts it beside the API). The reports acceptance
 * dataset (fixtures/reports-acceptance.ts) is added to company A on a property of its own. A company admin opens the
 * Reports page and then every report in turn, filters it to that property (the filter is kept in the URL), and exports
 * it: the CSV holds exactly the rows the report's table shows, every one of them of that property, and the known
 * dataset's count of them. One report is also checked in the print layout.
 *
 * Runs in its own Playwright project after every other spec (playwright.config.ts): the property it adds is removed with
 * everything on it in afterAll.
 */

/** Each report's table of rows (its caption), the rows its CSV exports, and how many the dataset has at its property. */
const REPORT_ROWS: Record<string, { table: string; rows: number }> = {
  portfolio_overview: { table: 'Portfolio overview by property', rows: 1 },
  occupancy: { table: 'Units and their current tenants', rows: 3 },
  lease_monitoring: { table: 'Monitoring events', rows: 2 },
  rental_discrepancies: { table: 'Billed against expected rental per lease', rows: 2 },
  lease_expiry: { table: 'Leases and their expiry', rows: 2 },
  renewal_deadlines: { table: 'Renewal notice deadlines', rows: 1 },
  deposits_guarantees: { table: 'Deposits and guarantees by lease', rows: 1 },
  arrears: { table: 'Accounts in arrears', rows: 2 },
  payment_arrangements: { table: 'Payment arrangements', rows: 1 },
  statement_processing: { table: 'Every statement upload', rows: 4 },
  communication_activity: { table: 'Every message', rows: 2 },
  owner_weekly_summary: { table: 'Weekly owner summaries', rows: 1 },
}

let dataset: ReportsDataset
let db: SupabaseClient

test.beforeAll(async () => {
  db = serviceRoleClient(e2eContext().supabase)
  dataset = await createReportsDataset(db, {
    companyId: e2eWorld().companies.a.id,
    managerUserId: e2eUser('manager').id,
    ownerUserId: e2eUser('owner').id,
    runId: `${e2eWorld().runId}e2e`,
    today: saToday(),
  })
})

test.afterAll(async () => {
  if (dataset) await removeReportsDataset(db, dataset)
})

/** RFC 4180 CSV (the export's format): rows of fields, the UTF-8 byte order mark dropped. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let value = ''
  let quoted = false
  const input = text.replace(/^﻿/, '')
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') {
        value += '"'
        index += 1
      } else if (char === '"') quoted = false
      else value += char
    } else if (char === '"') quoted = true
    else if (char === ',') {
      row.push(value)
      value = ''
    } else if (char === '\r' && input[index + 1] === '\n') {
      row.push(value)
      rows.push(row)
      row = []
      value = ''
      index += 1
    } else value += char
  }
  if (value !== '' || row.length > 0) rows.push([...row, value])
  return rows
}

/** Exports the report on screen and returns the CSV's file name and rows (header first). */
async function exportCsv(page: Page): Promise<{ fileName: string; rows: string[][] }> {
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export CSV' }).click()
  const file = await download
  const path = await file.path()
  return { fileName: file.suggestedFilename(), rows: parseCsv(await readFile(path, 'utf8')) }
}

test.describe('Reports acceptance', () => {
  // One dataset for both tests: they run in order in one worker.
  test.describe.configure({ mode: 'serial' })

  test('open each report, filter it to one property and export exactly its rows', async ({ page }) => {
    test.setTimeout(180_000)
    const property = dataset.property
    await signIn(page, e2eUser('admin'), '/reports')
    await expect(pageHeading(page)).toHaveText('Reports')

    const catalogue = page.getByRole('list', { name: 'Reports' }).getByRole('link')
    await expect(catalogue).toHaveCount(Object.keys(REPORT_ROWS).length)
    const titles = await catalogue.evaluateAll((links) => links.map((link) => link.querySelector('span span')?.textContent ?? ''))

    for (const title of titles) {
      await test.step(title, async () => {
        await page.goto('/reports')
        await page.getByRole('list', { name: 'Reports' }).getByRole('link', { name: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) }).click()
        await expect(pageHeading(page)).toHaveText(title)
        const reportId = new URL(page.url()).pathname.split('/').pop() ?? ''
        const expected = REPORT_ROWS[reportId]
        expect(expected, `a known report: ${reportId}`).toBeDefined()
        if (!expected) return

        // The property filter, kept in the URL.
        await page.getByRole('group', { name: 'Report filters' }).getByRole('button', { name: 'Property', exact: true }).click()
        await page.getByRole('checkbox', { name: property.name }).check()
        await page.keyboard.press('Escape')
        await expect.poll(() => decodeURIComponent(new URL(page.url()).search)).toContain(`propertyId=["${property.id}"]`)
        await expect(page.locator('section[aria-busy="true"]')).toHaveCount(0)

        const rows = page.getByRole('table', { name: expected.table }).locator('tbody tr')
        await expect(rows).toHaveCount(expected.rows)

        // The CSV holds exactly the rows shown, each of the filtered property.
        const csv = await exportCsv(page)
        expect(csv.fileName).toBe(`leaseguard-${reportId.replaceAll('_', '-')}-${saToday()}.csv`)
        const [header, ...lines] = csv.rows
        expect(lines).toHaveLength(expected.rows)
        const propertyColumn = header?.indexOf('Property') ?? -1
        const propertiesColumn = header?.indexOf('Properties') ?? -1
        if (propertyColumn >= 0) for (const line of lines) expect(line[propertyColumn]).toBe(property.name)
        else if (propertiesColumn >= 0) for (const line of lines) expect(line[propertiesColumn]?.split('; ')).toContain(property.name)
        else throw new Error(`The ${reportId} CSV names no property column (${header?.join(', ')})`)

        // Reloading keeps the filter (it lives in the URL) and the same rows.
        await page.reload()
        await expect(page.getByRole('table', { name: expected.table }).locator('tbody tr')).toHaveCount(expected.rows)
      })
    }
  })

  test('the print layout leaves the controls out and names the report and its filters', async ({ page }) => {
    // The URL the property filter writes (TanStack Router keeps the list as JSON).
    await signIn(page, e2eUser('admin'), `/reports/arrears?propertyId=${encodeURIComponent(JSON.stringify([dataset.property.id]))}`)
    await expect(page.getByRole('table', { name: 'Accounts in arrears' }).locator('tbody tr')).toHaveCount(2)
    await page.emulateMedia({ media: 'print' })
    await expect(page.getByRole('group', { name: 'Report filters' })).toBeHidden()
    await expect(page.getByRole('button', { name: 'Export CSV' })).toBeHidden()
    await expect(page.getByText(`Filtered: ${dataset.property.name}`)).toBeVisible()
    await expect(page.getByRole('table', { name: 'Accounts in arrears' })).toBeVisible()
  })
})
