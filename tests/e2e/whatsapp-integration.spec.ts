import { expect, test } from '@playwright/test'

import { expectShell, pageHeading, signIn } from './support/app.ts'
import { e2eUser } from './support/world.ts'

// The e2e API runs with the .env.example values: no Meta app settings and no worker, so the page must
// say what is missing and never show a number as connected.
test.describe('Settings → Integrations → WhatsApp', () => {
  test('shows a company admin what LeaseGuard needs from Meta, and no connected number', async ({ page }) => {
    // Facebook's SDK loads only when an admin connects; it must never be requested here (and never reach facebook.com).
    const facebookRequests: string[] = []
    await page.route(/(^https:\/\/([a-z0-9-]+\.)*(facebook\.com|facebook\.net)\/)/, (route) => {
      facebookRequests.push(route.request().url())
      return route.abort()
    })
    await signIn(page, e2eUser('admin'), '/settings/integrations/whatsapp')
    await expectShell(page)
    await expect(pageHeading(page)).toHaveText('WhatsApp')

    const banner = page.getByRole('alert', { name: 'Requires Meta configuration or approval' })
    await expect(banner).toContainText('WHATSAPP_APP_ID (API)')
    await expect(banner).toContainText('WHATSAPP_WEBHOOK_VERIFY_TOKEN (API)')
    // No worker runs, so the agent runtime is unknown: the page says so instead of blaming ANTHROPIC_API_KEY.
    await expect(banner).toContainText('the worker has not reported in the last five minutes')
    await expect(banner).not.toContainText('ANTHROPIC_API_KEY')
    const setup = page.getByRole('region', { name: 'Meta setup' })
    await expect(setup.getByText('Requires configuration')).toHaveCount(2)
    await expect(setup.getByText('Worker not reporting')).toHaveCount(1)

    await expect(page.getByText('No WhatsApp numbers yet')).toBeVisible()
    await expect(page.getByText('Connected', { exact: true })).toHaveCount(0)
    await expect(page.getByText(/Only company admins can connect/)).toHaveCount(0)

    // Connecting needs Embedded Signup configured on the API: the button is disabled and says why.
    const connect = page.getByRole('region', { name: 'Connect WhatsApp Business' })
    await expect(connect.getByText(/Requires Meta configuration/)).toBeVisible()
    await expect(connect.getByRole('button', { name: 'Connect WhatsApp Business' })).toBeDisabled()
    expect(facebookRequests).toEqual([])

    // The old settings link still leads here.
    await page.goto('/settings/whatsapp')
    await expect(page).toHaveURL(/\/settings\/integrations\/whatsapp$/)
    await expect(pageHeading(page)).toHaveText('WhatsApp')
  })

  test('is read-only for a member who is not a company admin', async ({ page }) => {
    await signIn(page, e2eUser('readOnly'), '/settings/integrations/whatsapp')
    await expect(pageHeading(page)).toHaveText('WhatsApp')
    await expect(page.getByText('Only company admins can connect or change WhatsApp numbers.', { exact: false })).toBeVisible()
    await expect(page.getByRole('button', { name: /connect/i })).toHaveCount(0)
  })
})
