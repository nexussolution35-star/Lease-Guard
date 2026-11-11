import { expect, test } from '@playwright/test'

import { localSql } from '../fixtures/local-db.ts'
import { serviceRoleClient } from '../fixtures/world.ts'
import { expectShell, pageHeading, signIn } from './support/app.ts'
import { e2eContext, e2eUser, e2eWorld } from './support/world.ts'

// The verification and inbox tests below add numbers to company A; the first test expects none, so this file runs in order.
test.describe.configure({ mode: 'serial' })

// The e2e API runs with the backend/.env.example values: no Meta app settings and no worker, so the page must
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

  test('shows a number Nexus Solution imported as pending until verified, and points its admins to Nexus', async ({ page }) => {
    const db = serviceRoleClient(e2eContext().supabase)
    const companyId = e2eWorld().companies.a.id
    const unique = `${Date.now()}`
    const accountId = `${unique}5`
    const phoneId = `${unique}6`
    try {
      // What `pnpm whatsapp:import-test-number -- --apply` stores (no worker in e2e, so the number stays pending).
      const imported = await db.rpc('import_whatsapp_number', {
        p_company_id: companyId,
        p_business_account_id: accountId,
        p_phone_number_id: phoneId,
        p_access_token: `EAAG-e2e-test-number-${unique}`,
        p_apply: true,
      })
      if (imported.error) throw new Error(`import: ${imported.error.message}`)
      expect((imported.data as { outcome: string }[])[0]?.outcome).toBe('new_number')

      await signIn(page, e2eUser('admin'), '/settings/integrations/whatsapp')
      await expect(page.getByText(`Number id ${phoneId}`)).toBeVisible()
      await expect(page.getByText(/Nexus Solution connected this number with the number import on/)).toBeVisible()
      await expect(page.getByText('Pending verification')).toBeVisible()
      await expect(page.getByText('Connected', { exact: true })).toHaveCount(0)

      await page.getByRole('button', { name: 'Disconnect' }).click()
      const confirm = page.getByRole('alertdialog')
      await expect(confirm).toContainText('ask Nexus Solution to import it again')
      await confirm.getByRole('button', { name: 'Disconnect' }).click()
      await expect(page.getByText(/Disconnected\. Ask Nexus Solution to import the number again/)).toBeVisible()
    } finally {
      await db.from('whatsapp_phone_numbers').delete().eq('phone_number_id', phoneId)
      await db.from('whatsapp_business_accounts').delete().eq('business_account_id', accountId)
      // The disconnect deleted the imported token; remove it anyway if the test stopped before that.
      await localSql(`delete from vault.secrets where name like 'whatsapp_access_token:${companyId}:import:%'`)
    }
  })
})

// Inbound routing (ticket 05): no worker and no Meta run in e2e, so the messages are recorded through the same
// service-role function the worker calls after the webhook. Each company sees only the messages sent to its number.
test.describe('WhatsApp conversations inbox', () => {
  test('shows a member the messages sent to their company’s number, never another company’s, and lets a manager take over and reply', async ({ page, browser }) => {
    const db = serviceRoleClient(e2eContext().supabase)
    const companies = { a: e2eWorld().companies.a.id, b: e2eWorld().companies.b.id }
    const unique = `${Date.now()}`
    const sender = `2784${unique.slice(-7)}`
    const ids = { a: { account: `${unique}1`, phone: `${unique}2` }, b: { account: `${unique}3`, phone: `${unique}4` } }
    const numbers: string[] = []
    const throwOn = (what: string, result: { error: { message: string } | null }) => {
      if (result.error) throw new Error(`${what}: ${result.error.message}`)
    }
    try {
      for (const key of ['a', 'b'] as const) {
        throwOn('account', await db.from('whatsapp_business_accounts').insert({ company_id: companies[key], business_account_id: ids[key].account }))
        const inserted = await db
          .from('whatsapp_phone_numbers')
          .insert({
            company_id: companies[key],
            business_account_id: ids[key].account,
            phone_number_id: ids[key].phone,
            display_name: '',
            display_number: key === 'a' ? '+27 11 555 0188' : '+27 12 555 0288',
            connection_status: 'connected',
          })
          .select('id')
          .single()
        throwOn('number', inserted)
        const numberId = (inserted.data as { id: string }).id
        numbers.push(numberId)
        throwOn(
          'message',
          await db.rpc('record_whatsapp_inbound_message', {
            p_company_id: companies[key],
            p_number_id: numberId,
            p_provider_message_id: `wamid.e2e-${key}-${unique}`,
            p_user_id: null,
            p_wa_id: sender,
            p_profile_name: 'E2E Sender',
            p_body: key === 'a' ? 'Is there parking for visitors?' : 'Message for company B only',
            p_sent_at: new Date().toISOString(),
          }),
        )
      }

      await signIn(page, e2eUser('readOnly'), '/whatsapp/conversations')
      await expectShell(page)
      await expect(pageHeading(page)).toHaveText('Conversations')
      const inbox = page.getByRole('list', { name: 'Conversations' })
      const conversation = inbox.getByRole('button', { name: /E2E Sender/ })
      await expect(conversation).toContainText('Is there parking for visitors?')
      await expect(page.getByText('Message for company B only')).toHaveCount(0)

      await conversation.click()
      await expect(page).toHaveURL(/conversation=/)
      const thread = page.getByRole('list', { name: 'Messages' })
      await expect(thread.getByRole('listitem')).toHaveCount(1)
      await expect(thread).toContainText('Is there parking for visitors?')
      await expect(page.getByText(`+${sender}`)).toBeVisible()
      // A read-only member sees the reply box disabled and no handover actions (ticket 07).
      await expect(page.getByText('Only company admins and property managers can reply.')).toBeVisible()
      await expect(page.getByRole('textbox', { name: 'Message' })).toBeDisabled()
      await expect(page.getByRole('button', { name: 'Take over' })).toHaveCount(0)

      // A property manager (own browser session) takes the conversation over and replies inside the 24-hour window
      // (ticket 07). No worker runs in e2e, so the reply stays approved and queued.
      const managerContext = await browser.newContext({ baseURL: test.info().project.use.baseURL })
      const manager = await managerContext.newPage()
      try {
        await signIn(manager, e2eUser('manager'), '/whatsapp/conversations')
        await manager.getByRole('list', { name: 'Conversations' }).getByRole('button', { name: /E2E Sender/ }).click()
        await expect(manager.getByText(/Reply window: \d+ h \d+ min left/)).toBeVisible()
        await manager.getByRole('button', { name: 'Take over' }).click()
        await expect(manager.getByRole('region', { name: 'Handover' })).toContainText('Taken over by you')
        await manager.getByRole('textbox', { name: 'Message' }).fill('Yes, visitors park in bay 4.')
        await manager.getByRole('button', { name: 'Send reply' }).click()
        const replies = manager.getByRole('list', { name: 'Messages' })
        await expect(replies.getByRole('listitem')).toHaveCount(2)
        await expect(replies).toContainText('Yes, visitors park in bay 4.')
        await expect(manager.getByRole('textbox', { name: 'Message' })).toHaveValue('')
        await manager.getByRole('button', { name: 'Assigned to me' }).click()
        await expect(manager).toHaveURL(/filter=mine/)
        await expect(manager.getByRole('list', { name: 'Conversations' }).getByRole('button', { name: /E2E Sender/ })).toBeVisible()
      } finally {
        await managerContext.close()
      }
    } finally {
      const conversations = await db.from('whatsapp_conversations').select('id').in('number_id', numbers)
      const conversationIds = ((conversations.data ?? []) as { id: string }[]).map((c) => c.id)
      if (conversationIds.length > 0) {
        await db.from('communications').delete().in('conversation_id', conversationIds)
        await db.from('whatsapp_conversations').delete().in('id', conversationIds)
      }
      await db.from('whatsapp_contacts').delete().in('company_id', [companies.a, companies.b]).eq('wa_id', sender)
      await db.from('whatsapp_phone_numbers').delete().in('phone_number_id', [ids.a.phone, ids.b.phone])
      await db.from('whatsapp_business_accounts').delete().in('business_account_id', [ids.a.account, ids.b.account])
    }
  })
})

// WhatsApp setup (ticket 11): the ten steps come from the API's verified facts. No worker and no Meta run in e2e, so
// the test message's send and Meta's delivered status are recorded as the worker would record them.
test.describe('WhatsApp setup', () => {
  test('shows a company admin the setup steps on the WhatsApp page and a summary on the dashboard', async ({ page }) => {
    await signIn(page, e2eUser('admin'), '/settings/integrations/whatsapp')
    const setup = page.getByRole('region', { name: 'WhatsApp setup' })
    await expect(setup.getByRole('progressbar', { name: /of 10 steps done/ })).toBeVisible()
    await expect(setup.getByRole('listitem')).toHaveCount(10)
    const meta = setup.getByRole('listitem').filter({ hasText: 'Meta account connected' })
    await expect(meta.getByText('Action needed')).toBeVisible()
    await expect(setup.getByRole('button', { name: 'Activate WhatsApp' })).toBeDisabled()

    await page.goto('/')
    const summary = page.getByRole('region', { name: 'WhatsApp setup' })
    await expect(summary.getByText(/of 10 steps done/)).toBeVisible()
    await summary.getByRole('link', { name: 'Open the WhatsApp setup' }).click()
    await expect(page).toHaveURL(/\/settings\/integrations\/whatsapp$/)
  })

  test('shows no setup summary on the dashboard to a member who is not a company admin', async ({ page }) => {
    await signIn(page, e2eUser('readOnly'), '/')
    await expect(pageHeading(page)).toHaveText('Dashboard')
    await expect(page.getByRole('region', { name: 'WhatsApp setup' })).toHaveCount(0)
  })

  test('sends a test message and activates WhatsApp once Meta reports it delivered', async ({ page }) => {
    const db = serviceRoleClient(e2eContext().supabase)
    const companyId = e2eWorld().companies.a.id
    const unique = `${Date.now()}`
    const accountId = `${unique}7`
    const phoneId = `${unique}8`
    const wamid = `wamid.e2e-setup-${unique}`
    const throwOn = (what: string, result: { error: { message: string } | null }) => {
      if (result.error) throw new Error(`${what}: ${result.error.message}`)
    }
    try {
      // What number verification records once Meta confirmed everything (no worker and no Meta in e2e).
      throwOn('account', await db.from('whatsapp_business_accounts').insert({ company_id: companyId, business_account_id: accountId }))
      throwOn(
        'number',
        await db.from('whatsapp_phone_numbers').insert({
          company_id: companyId,
          business_account_id: accountId,
          phone_number_id: phoneId,
          display_name: 'Atlas Leasing',
          display_number: '+27 11 555 0177',
          connection_status: 'connected',
          webhook_configured: true,
          last_verified_at: new Date().toISOString(),
        }),
      )
      throwOn(
        'template',
        await db.from('whatsapp_message_templates').insert({
          company_id: companyId,
          business_account_id: accountId,
          meta_template_id: `${unique}9`,
          name: 'hello_world',
          language: 'en_US',
          category: 'UTILITY',
          status: 'APPROVED',
        }),
      )

      await signIn(page, e2eUser('admin'), '/settings/integrations/whatsapp')
      const setup = page.getByRole('region', { name: 'WhatsApp setup' })
      const testStep = setup.getByRole('listitem').filter({ hasText: 'Test message successful' })
      await expect(testStep.getByText('Action needed')).toBeVisible()
      await testStep.getByRole('button', { name: 'Send test message' }).click()

      const dialog = page.getByRole('dialog', { name: 'Send a test message' })
      await dialog.getByRole('combobox', { name: /Send from/ }).click()
      await page.getByRole('option', { name: /\+27 11 555 0177/ }).click()
      await dialog.getByRole('combobox', { name: /Approved template/ }).click()
      await page.getByRole('option', { name: /hello_world/ }).click()
      await dialog.getByRole('textbox', { name: /Your WhatsApp number/ }).fill('082 999 0177')
      await dialog.getByRole('button', { name: 'Send test message' }).click()
      await expect(dialog).toHaveCount(0)
      await expect(setup.getByText('Latest test message: Queued')).toBeVisible()
      await expect(testStep.getByText('Waiting on Meta')).toBeVisible()
      await expect(setup.getByRole('button', { name: 'Activate WhatsApp' })).toBeDisabled()

      // The worker sends it; Meta's status webhook then reports it delivered.
      throwOn(
        'sent',
        await db
          .from('whatsapp_test_messages')
          .update({ status: 'sent', provider_message_id: wamid, sent_at: new Date().toISOString() })
          .eq('company_id', companyId)
          .eq('to_number', '+27829990177'),
      )
      const delivered = await db.rpc('record_whatsapp_test_message_status', {
        p_company_id: companyId,
        p_provider_message_id: wamid,
        p_status: 'delivered',
        p_occurred_at: new Date().toISOString(),
      })
      throwOn('delivered', delivered)

      // The page polls while it waits on Meta.
      await expect(testStep.getByText('Done')).toBeVisible({ timeout: 15_000 })
      await setup.getByRole('button', { name: 'Activate WhatsApp' }).click()
      await expect(setup.getByText(/WhatsApp is active since/)).toBeVisible()
    } finally {
      await db.from('companies').update({ whatsapp_activated_at: null, whatsapp_activated_by_user_id: null }).eq('id', companyId)
      await db.from('whatsapp_test_messages').delete().eq('company_id', companyId)
      await db.from('whatsapp_message_templates').delete().eq('business_account_id', accountId)
      await db.from('whatsapp_phone_numbers').delete().eq('phone_number_id', phoneId)
      await db.from('whatsapp_business_accounts').delete().eq('business_account_id', accountId)
    }
  })
})
