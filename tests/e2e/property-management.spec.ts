import { expect, test } from '@playwright/test'

import { serviceRoleClient } from '../fixtures/world.ts'
import { pageHeading, signIn } from './support/app.ts'
import { e2eContext, e2eUser, e2eWorld } from './support/world.ts'

// Adds, edits, archives and restores a property in company A, then removes it. Runs in the
// 'chromium-portfolio-writes' project, after every other spec (they assert the world's property lists).
test.describe.configure({ mode: 'serial' })

/** A code unique to this run: 'E' and the last six letters or digits of the run id. */
const code = () => `E${e2eWorld().runId.replace(/[^a-z0-9]/gi, '').slice(-6).toUpperCase()}`
const name = () => `E2E Rosebank Corner ${e2eWorld().runId}`

test.describe('property management', () => {
  test.afterAll(async () => {
    const db = serviceRoleClient(e2eContext().supabase)
    await db.from('properties').delete().eq('company_id', e2eWorld().companies.a.id).eq('code', code())
  })

  test('a property manager adds a property, edits it, archives it and restores it', async ({ page }) => {
    const manager = e2eUser('manager')
    await signIn(page, manager, '/properties')

    await page.getByRole('button', { name: 'Add property' }).click()
    const dialog = page.getByRole('dialog', { name: 'Add property' })
    await dialog.getByLabel(/^Name/).fill(name())
    await dialog.getByLabel(/^Code/).fill(code().toLowerCase())
    await dialog.getByRole('combobox', { name: /^Type/ }).click()
    await page.getByRole('option', { name: 'Office' }).click()
    await dialog.getByLabel(/^Gross lettable area/).fill('4200')
    await dialog.getByLabel(/^Street address/).fill('1 Cradock Avenue')
    await dialog.getByLabel(/^Suburb/).fill('Rosebank')
    await dialog.getByLabel(/^City or town/).fill('Johannesburg')
    await dialog.getByRole('combobox', { name: /^Province/ }).click()
    await page.getByRole('option', { name: 'Gauteng' }).click()
    await dialog.getByLabel(/^Postal code/).fill('2196')
    await dialog.getByRole('combobox', { name: /^Accounting system/ }).click()
    await page.getByRole('option', { name: 'Sage' }).click()
    await dialog.getByRole('button', { name: 'Add property' }).click()

    // The new property opens on its own screen, managed by the person who added it.
    await expect(pageHeading(page)).toHaveText(name())
    await expect(page).toHaveURL(/\/properties\/[0-9a-f-]{36}$/)
    await expect(page.getByRole('main').getByText(`${code()} · Office`)).toBeVisible()
    const details = page.getByRole('region', { name: 'Details' })
    await expect(details).toContainText(manager.fullName)
    await expect(page.getByRole('region', { name: 'Units' })).toContainText('No units yet')

    await page.getByRole('button', { name: 'Edit' }).click()
    const edit = page.getByRole('dialog', { name: `Edit ${name()}` })
    await expect(edit.getByLabel(/^Code/)).toBeDisabled()
    await edit.getByLabel(/^Gross lettable area/).fill('4350')
    await edit.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByText(`${name()} saved`)).toBeVisible()
    await expect(details).toContainText('4 350 m²')

    await page.getByRole('button', { name: 'Archive' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Archive property' }).click()
    await expect(page.getByText('This property is archived.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(0)

    await page.getByRole('button', { name: 'Restore' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Restore property' }).click()
    await expect(page.getByText(`${name()} restored`)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible()
  })

  test('a property with leases that have not ended cannot be archived', async ({ page }) => {
    const withLeases = e2eWorld().companies.a.properties.find((property) => property.code === 'ACP')
    if (!withLeases) throw new Error('The world has no ACP property')
    await signIn(page, e2eUser('manager'), `/properties/${withLeases.id}`)
    await page.getByRole('button', { name: 'Archive' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Archive property' }).click()
    await expect(page.getByText('The property was not archived')).toBeVisible()
    await expect(page.getByText(/still has leases that have not ended/)).toBeVisible()
    // The confirmation stays open after a refusal; cancelling it leaves the property unchanged.
    await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByRole('button', { name: 'Archive' })).toBeVisible()
    await expect(page.getByText('This property is archived.')).toHaveCount(0)
  })

  test('a read-only member sees the property but cannot change it', async ({ page }) => {
    const property = e2eWorld().companies.a.properties[0]
    if (!property) throw new Error('The world has no properties')
    await signIn(page, e2eUser('readOnly'), '/properties')
    await expect(page.getByRole('button', { name: 'Add property' })).toHaveCount(0)
    await page.goto(`/properties/${property.id}`)
    await expect(pageHeading(page)).toHaveText(property.name)
    for (const action of ['Edit', 'Archive', 'Restore']) await expect(page.getByRole('button', { name: action })).toHaveCount(0)
  })
})
