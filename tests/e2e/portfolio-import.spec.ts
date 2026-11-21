import { expect, test } from '@playwright/test'

import { serviceRoleClient } from '../fixtures/world.ts'
import { signIn } from './support/app.ts'
import { e2eContext, e2eUser, e2eWorld } from './support/world.ts'

// Imports a two-property, four-unit file into company A, approves it and finds the records on the Properties and
// Units screens (ticket I-04), then removes them. Runs in the 'chromium-portfolio-writes' project, after every other
// spec (they assert the world's property lists).
test.describe.configure({ mode: 'serial' })

/** Property codes unique to this run: a letter and the last six letters or digits of the run id. */
const suffix = () => e2eWorld().runId.replace(/[^a-z0-9]/gi, '').slice(-6).toUpperCase()
const codes = () => [`P${suffix()}`, `Q${suffix()}`] as const
const names = () => [`E2E Import Park ${e2eWorld().runId}`, `E2E Import Centre ${e2eWorld().runId}`] as const
const unitNumbers = () => [`${codes()[0]}-A1`, `${codes()[0]}-A2`, `${codes()[1]}-S1`, `${codes()[1]}-S2`] as const

function portfolioFile(): Buffer {
  const [park, centre] = codes()
  const [parkName, centreName] = names()
  const [a1, a2, s1, s2] = unitNumbers()
  const parkColumns = `${park},${parkName},Office,5 Bath Avenue,Rosebank,Johannesburg,Gauteng,2196,4000`
  const centreColumns = `${centre},${centreName},Shopping centre,9 Long Street,Cape Town City Centre,Cape Town,Western Cape,8001,9000`
  return Buffer.from(
    [
      'Property code,Property name,Property type,Address line 1,Suburb,City,Province,Postal code,Gross lettable area (m²),Unit number,Unit type,Floor area (m²),Unit status',
      `${parkColumns},${a1},Office suite,150,Vacant`,
      `${parkColumns},${a2},Office suite,90,Vacant`,
      `${centreColumns},${s1},Line shop,80,Vacant`,
      `${centreColumns},${s2},Kiosk,12,Vacant`,
      '',
    ].join('\r\n'),
    'utf8',
  )
}

test.describe('portfolio import', () => {
  test.afterAll(async () => {
    const db = serviceRoleClient(e2eContext().supabase)
    await db.from('properties').delete().eq('company_id', e2eWorld().companies.a.id).in('code', [...codes()])
  })

  test('a property manager imports two properties with four units, approves them and finds them on the Properties and Units screens', async ({ page }) => {
    await signIn(page, e2eUser('manager'), '/properties/import')

    await page.locator('input[type="file"]').setInputFiles({ name: 'portfolio.csv', mimeType: 'text/csv', buffer: portfolioFile() })
    await page.getByRole('button', { name: 'Upload file' }).click()
    await expect(page.getByText(/portfolio\.csv accepted: 4 rows/)).toBeVisible()

    const approval = page.getByRole('region', { name: 'Approve the import' })
    const summary = approval.getByLabel('Import summary')
    await expect(summary.getByText('Properties to create').locator('..')).toContainText('2')
    await expect(summary.getByText('Units to create').locator('..')).toContainText('4')
    await expect(approval.getByText(/Tenant messaging stays off/)).toBeVisible()

    await approval.getByRole('combobox', { name: 'Accounting system for the new properties' }).click()
    await page.getByRole('option', { name: 'MRI' }).click()
    await approval.getByRole('button', { name: 'Approve and import' }).click()
    await expect(page.getByText('Import approved')).toBeVisible()

    const created = approval.getByRole('list', { name: 'Records created' })
    await expect(created.getByRole('listitem')).toHaveCount(6)
    for (const name of names()) await expect(created.getByRole('link', { name: new RegExp(name) })).toBeVisible()
    await expect(approval.getByText(e2eUser('manager').fullName)).toBeVisible()

    // The properties are on the Properties screen.
    await page.goto('/properties')
    await page.getByRole('searchbox', { name: 'Search properties' }).fill(suffix())
    for (const name of names()) await expect(page.getByRole('main').getByText(name)).toBeVisible()

    // The units are on the Units screen.
    await page.goto('/units')
    const search = page.getByRole('searchbox', { name: 'Search units' })
    for (const unit of unitNumbers()) {
      await search.fill(unit)
      await expect(page.getByRole('main').getByText(unit, { exact: true })).toBeVisible()
    }
  })
})
