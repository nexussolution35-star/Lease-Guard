import { expect, test } from '@playwright/test'

import { expectShell, pageHeading, signIn, signInWith, signOut } from './support/app.ts'
import { e2eUser } from './support/world.ts'

test.describe('sign-in and sign-out (local Supabase Auth)', () => {
  test('a signed-out visitor is sent to the login page and returns to the requested page after signing in', async ({ page }) => {
    const user = e2eUser('manager')
    await page.goto('/properties')
    await expect(page).toHaveURL('/login?redirect=%2Fproperties')
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in to LeaseGuard' })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0)

    await signInWith(page, user.email, user.password)
    await expect(page).toHaveURL('/properties')
    await expectShell(page)
    await expect(pageHeading(page)).toHaveText('Properties')
  })

  test('a wrong password is refused with a clear message', async ({ page }) => {
    const user = e2eUser('manager')
    await page.goto('/login')
    await signInWith(page, user.email, `${user.password}-wrong`)
    await expect(page.getByText('The email address or password is incorrect.')).toBeVisible()
    await expect(page).toHaveURL('/login')
  })

  test('signing out returns to the login page and protects the app again', async ({ page }) => {
    const user = e2eUser('manager')
    await signIn(page, user)
    await signOut(page, user.fullName)
    await page.goto('/leases')
    await expect(page).toHaveURL('/login?redirect=%2Fleases')
  })
})
