import { expect, test } from '@playwright/test'

import { expectShell, pageHeading, propertiesTable, propertyLinks, signIn } from './support/app.ts'
import { e2eUser, e2eWorld } from './support/world.ts'

const byName = (a: string, b: string) => a.localeCompare(b)

test.describe('properties list and detail', () => {
  const properties = () => e2eWorld().companies.a.properties
  const names = () => properties().map((property) => property.name).sort(byName)

  test.beforeEach(async ({ page }) => {
    await signIn(page, e2eUser('manager'), '/properties')
  })

  test("lists the active workspace's properties, sorted by name", async ({ page }) => {
    await expectShell(page)
    await expect(pageHeading(page)).toHaveText('Properties')
    await expect(propertyLinks(page)).toHaveText(names())
    await expect(page.getByRole('navigation', { name: 'Pagination' })).toContainText(`Showing 1–${names().length} of ${names().length}`)

    // Sorting by the Property column again reverses the order and is kept in the URL.
    await propertiesTable(page).getByRole('button', { name: 'Property' }).click()
    await expect(page).toHaveURL(/direction=desc/)
    await expect(propertyLinks(page)).toHaveText([...names()].reverse())
  })

  test('searches by name and filters by type, and clears the filters', async ({ page }) => {
    const office = properties().find((p) => p.type === 'office')
    const industrial = properties().find((p) => p.type === 'industrial_warehouse')
    if (!office || !industrial) throw new Error('The world has no office or industrial property')
    await expect(propertyLinks(page)).toHaveCount(names().length)

    const word = office.name.split(' ')[0] ?? office.name
    await page.getByRole('searchbox', { name: 'Search properties' }).fill(word)
    await expect(propertyLinks(page)).toHaveText([office.name])
    await expect(page).toHaveURL(new RegExp(`search=${word}`))

    await page.getByRole('button', { name: 'Clear filters' }).first().click()
    await expect(propertyLinks(page)).toHaveCount(names().length)

    await page.getByRole('combobox', { name: 'Type' }).click()
    await page.getByRole('option', { name: 'Industrial / warehouse' }).click()
    await expect(propertyLinks(page)).toHaveText([industrial.name])
    await expect(page).toHaveURL(/type=industrial_warehouse/)

    await page.getByRole('searchbox', { name: 'Search properties' }).fill('no property is called this')
    await expect(page.getByText('No matching records')).toBeVisible()
    await expect(propertiesTable(page)).toHaveCount(0)
  })

  test('pages through the list', async ({ page }) => {
    const sorted = names()
    expect(sorted.length).toBe(4)
    await page.goto('/properties?pageSize=2')
    const pagination = page.getByRole('navigation', { name: 'Pagination' })

    await expect(pagination).toContainText(`Showing 1–2 of ${sorted.length}`)
    await expect(pagination).toContainText('Page 1 of 2')
    await expect(propertyLinks(page)).toHaveText(sorted.slice(0, 2))
    await expect(pagination.getByRole('button', { name: 'Previous page' })).toBeDisabled()

    await pagination.getByRole('button', { name: 'Next page' }).click()
    await expect(pagination).toContainText(`Showing 3–4 of ${sorted.length}`)
    await expect(pagination).toContainText('Page 2 of 2')
    await expect(propertyLinks(page)).toHaveText(sorted.slice(2, 4))
    await expect(pagination.getByRole('button', { name: 'Next page' })).toBeDisabled()
    await expect(page).toHaveURL(/page=2/)

    await pagination.getByRole('button', { name: 'Previous page' }).click()
    await expect(propertyLinks(page)).toHaveText(sorted.slice(0, 2))
  })

  test('opens a property detail screen from the list', async ({ page }) => {
    const target = properties()[0]
    if (!target) throw new Error('The world has no properties')
    await propertyLinks(page).filter({ hasText: target.name }).click()
    await expect(page).toHaveURL(`/properties/${target.id}`)
    await expectShell(page)
    await expect(pageHeading(page)).toHaveText(target.name)
  })
})
