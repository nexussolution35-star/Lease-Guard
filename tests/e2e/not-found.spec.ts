import { expect, test } from '@playwright/test'

import { expectShell, pageHeading, signIn } from './support/app.ts'
import { e2eUser } from './support/world.ts'

test.describe('not-found states inside the shell', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, e2eUser('manager'))
  })

  test('an unknown route shows "Page not found" with the navigation still available', async ({ page }) => {
    await page.goto('/this-route-does-not-exist')
    await expectShell(page)
    await expect(page.getByRole('main').getByText('Page not found', { exact: true })).toBeVisible()
    await expect(page.getByText('The page you were looking for does not exist.')).toBeVisible()

    await page.getByRole('main').getByRole('link', { name: 'Go to dashboard' }).click()
    await expect(page).toHaveURL('/')
    await expect(pageHeading(page)).toHaveText('Dashboard')
  })

  test('an unknown report id shows "Report not found" inside the shell', async ({ page }) => {
    await page.goto('/reports/not-a-real-report')
    await expectShell(page)
    await expect(pageHeading(page)).toHaveText('Report not found')
    await expect(page.getByText('There is no report with this name. Choose one from the reports list.')).toBeVisible()

    await page.getByRole('main').getByRole('link', { name: 'Back to reports' }).click()
    await expect(page).toHaveURL('/reports')
    await expect(pageHeading(page)).toHaveText('Reports')
  })

  test('a property id that does not exist shows "Property not found"', async ({ page }) => {
    await page.goto('/properties/00000000-0000-4000-8000-000000000000')
    await expect(pageHeading(page)).toHaveText('Property not found')
  })
})
