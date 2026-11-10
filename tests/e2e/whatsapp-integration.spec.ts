import { expect, test } from '@playwright/test'

import { serviceRoleClient } from '../fixtures/world.ts'
import { expectShell, pageHeading, signIn } from './support/app.ts'
import { e2eContext, e2eUser, e2eWorld } from './support/world.ts'

// The verification test below adds a number to company A; the first test expects none, so this file runs in order.
test.describe.configure({ mode: 'serial' })

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

  test('shows a number’s verification steps, registers it with a PIN and disconnects it', async ({ page }) => {
    const db = serviceRoleClient(e2eContext().supabase)
    const companyId = e2eWorld().companies.a.id
    const unique = `${Date.now()}`
    const accountId = `${unique}1`
    const phoneId = `${unique}2`
    const throwOn = (what: string, result: { error: { message: string } | null }) => {
      if (result.error) throw new Error(`${what}: ${result.error.message}`)
    }
    try {
      // What the worker records after checking with Meta (no worker and no Meta in e2e).
      throwOn('account', await db.from('whatsapp_business_accounts').insert({ company_id: companyId, business_account_id: accountId }))
      const inserted = await db
        .from('whatsapp_phone_numbers')
        .insert({ company_id: companyId, business_account_id: accountId, phone_number_id: phoneId, display_name: '', display_number: '+27 11 555 0199', connection_status: 'pending_verification' })
        .select('id')
        .single()
      throwOn('number', inserted)
      const numberId = (inserted.data as { id: string }).id
      throwOn(
        'steps',
        await db.from('whatsapp_number_verification_steps').insert(
          ['token_scopes', 'phone_number', 'webhook_subscription', 'registration', 'message_templates'].map((step) => ({
            company_id: companyId,
            number_id: numberId,
            step,
            status: step === 'registration' ? 'action_needed' : 'passed',
            message: step === 'registration' ? 'The number must be registered for the WhatsApp Cloud API.' : null,
            recovery: step === 'registration' ? 'Click Register number and enter a 6-digit PIN.' : null,
            checked_at: new Date().toISOString(),
          })),
        ),
      )
      throwOn(
        'templates',
        await db.rpc('sync_whatsapp_message_templates', {
          p_company_id: companyId,
          p_business_account_id: accountId,
          p_templates: [{ id: `${unique}9`, name: 'e2e_monthly_statement', language: 'en_ZA', category: 'UTILITY', status: 'APPROVED' }],
        }),
      )

      await signIn(page, e2eUser('admin'), '/settings/integrations/whatsapp')
      const steps = page.getByRole('list', { name: 'Verification steps' })
      await expect(steps.getByRole('listitem')).toHaveCount(5)
      await expect(steps.getByRole('listitem').nth(3)).toContainText('Action needed')
      await expect(page.getByText('Pending verification')).toBeVisible()
      await expect(page.getByText('Connected', { exact: true })).toHaveCount(0)
      const templates = page.getByRole('region', { name: 'Message templates' })
      await expect(templates.getByRole('row', { name: /e2e_monthly_statement/ })).toContainText('Approved')

      await page.getByRole('button', { name: 'Register number' }).click()
      const dialog = page.getByRole('dialog', { name: 'Register number' })
      await dialog.getByLabel(/6-digit PIN/).fill('123456')
      await dialog.getByRole('button', { name: 'Register number' }).click()
      await expect(page.getByText(/registering the number with Meta/)).toBeVisible()
      await expect(dialog).toHaveCount(0)

      await page.getByRole('button', { name: 'Disconnect' }).click()
      await page.getByRole('alertdialog').getByRole('button', { name: 'Disconnect' }).click()
      await expect(page.getByText(/Disconnected\. Connect the number again/)).toBeVisible()
      const stored = await db.from('whatsapp_phone_numbers').select('connection_status').eq('id', numberId).single()
      expect(stored.data).toEqual({ connection_status: 'disconnected' })
    } finally {
      await db.from('whatsapp_phone_numbers').delete().eq('phone_number_id', phoneId)
      await db.from('whatsapp_business_accounts').delete().eq('business_account_id', accountId)
    }
  })
})
