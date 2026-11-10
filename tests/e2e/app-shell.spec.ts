import { expect, test } from '@playwright/test'

import { expectShell, mainNavigation, NAV_ITEMS, navLink, pageHeading, signIn, workspaceSwitcher } from './support/app.ts'
import { e2eUser, e2eWorld } from './support/world.ts'

test.describe('application shell', () => {
  test('loads the dashboard inside the shell with the full navigation and the default workspace', async ({ page }) => {
    await signIn(page, e2eUser('manager'))
    await expectShell(page)
    await expect(page).toHaveTitle('LeaseGuard')
    await expect(pageHeading(page)).toHaveText('Dashboard')
    await expect(workspaceSwitcher(page)).toHaveAccessibleName(`Workspace: ${e2eWorld().companies.a.tradingName}. Switch workspace`)

    const links = mainNavigation(page).getByRole('link')
    await expect(links).toHaveCount(NAV_ITEMS.length)
    for (const item of NAV_ITEMS) await expect(navLink(page, item.label)).toHaveAttribute('href', item.path)
    await expect(navLink(page, 'Dashboard')).toHaveAttribute('aria-current', 'page')
  })

  test('navigates between screens from the sidebar and marks the active item', async ({ page }) => {
    await signIn(page, e2eUser('manager'))
    for (const label of ['Properties', 'Leases', 'Reports'] as const) {
      const item = NAV_ITEMS.find((candidate) => candidate.label === label)
      if (!item) throw new Error(`No navigation item ${label}`)
      await navLink(page, label).click()
      await expect(page).toHaveURL(item.path)
      await expect(pageHeading(page)).toHaveText(label)
      await expect(navLink(page, label)).toHaveAttribute('aria-current', 'page')
      await expect(navLink(page, 'Dashboard')).not.toHaveAttribute('aria-current', 'page')
    }
  })
})
