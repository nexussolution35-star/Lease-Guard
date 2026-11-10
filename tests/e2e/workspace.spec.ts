import { expect, test } from '@playwright/test'

import { openAccountMenu, pageHeading, propertyLinks, signIn, switchWorkspace, workspaceSwitcher } from './support/app.ts'
import { e2eUser, e2eWorld } from './support/world.ts'

const byName = (a: string, b: string) => a.localeCompare(b)

test.describe('workspace switching (a user with two companies)', () => {
  test("switching company shows only that company's records, and the choice survives a reload", async ({ page }) => {
    const { a, b } = e2eWorld().companies
    const aNames = a.properties.map((p) => p.name).sort(byName)
    const bNames = b.properties.map((p) => p.name).sort(byName)
    await signIn(page, e2eUser('manager'), '/properties')
    await expect(propertyLinks(page)).toHaveText(aNames)

    await switchWorkspace(page, b.tradingName)
    await expect(page.getByText(`Switched to ${b.tradingName}`)).toBeVisible()
    await expect(propertyLinks(page)).toHaveText(bNames)
    for (const name of aNames) await expect(page.getByText(name, { exact: true })).toHaveCount(0)

    // The workspace is remembered per user in this browser.
    await page.reload()
    await expect(workspaceSwitcher(page)).toHaveAccessibleName(`Workspace: ${b.tradingName}. Switch workspace`)
    await expect(propertyLinks(page)).toHaveText(bNames)

    // The account menu switches back.
    const manager = e2eUser('manager')
    const menu = await openAccountMenu(page, manager.fullName)
    await menu.getByRole('menuitem', { name: 'Switch workspace' }).click()
    await page.getByRole('menuitemradio', { name: new RegExp(a.tradingName) }).click()
    await expect(workspaceSwitcher(page)).toHaveAccessibleName(`Workspace: ${a.tradingName}. Switch workspace`)
    await expect(propertyLinks(page)).toHaveText(aNames)
  })

  test('a record of another workspace is not found in the active one', async ({ page }) => {
    const { a, b } = e2eWorld().companies
    const property = a.properties[0]
    if (!property) throw new Error('The world has no properties')
    await signIn(page, e2eUser('manager'), '/properties')
    await switchWorkspace(page, b.tradingName)
    await page.goto(`/properties/${property.id}`)
    await expect(pageHeading(page)).toHaveText('Property not found')
    await expect(page.getByText('Property not found in this workspace')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Back to properties' })).toHaveAttribute('href', '/properties')
  })
})
