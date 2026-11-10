import { expect, test } from '@playwright/test'

import { serviceRoleClient } from '../fixtures/world.ts'
import { expectShell, pageHeading, signIn } from './support/app.ts'
import { e2eContext, e2eUser, e2eWorld } from './support/world.ts'

// Saves company A's agent and knowledge; the test removes what it added.
test.describe.configure({ mode: 'serial' })

test.describe('Settings → Integrations → WhatsApp → AI agent', () => {
  test.afterAll(async () => {
    const db = serviceRoleClient(e2eContext().supabase)
    const companyId = e2eWorld().companies.a.id
    await db.from('whatsapp_knowledge_faqs').delete().eq('company_id', companyId)
    await db.from('whatsapp_agent_configs').delete().eq('company_id', companyId)
  })

  test('a company admin reads the safeguards, saves the agent and approves an FAQ', async ({ page }) => {
    const marker = Date.now().toString(36)
    await signIn(page, e2eUser('admin'), '/settings/integrations/whatsapp')
    await expectShell(page)
    await page.getByRole('link', { name: 'Set up the AI agent' }).click()
    await expect(pageHeading(page)).toHaveText('AI agent')

    const safeguards = page.getByRole('region', { name: 'Safeguards that always apply' })
    await expect(safeguards).toContainText('Tenants are never answered automatically')

    const form = page.getByRole('form', { name: 'AI agent settings' })
    await form.getByLabel(/Agent name/).fill(`Atlas assistant ${marker}`)
    await form.getByRole('button', { name: 'Add opening period' }).click()
    await form.getByLabel('Answer frequently asked questions').check()
    await form.getByRole('switch', { name: 'Reply to contacts automatically' }).click()
    await form.getByLabel('Out-of-hours message').fill('We are closed and will reply on the next working day.')
    await form.getByRole('button', { name: 'Save AI agent settings' }).click()
    await expect(page.getByText('AI agent settings saved')).toBeVisible()

    await page.reload()
    await expect(page.getByRole('form', { name: 'AI agent settings' }).getByLabel(/Agent name/)).toHaveValue(`Atlas assistant ${marker}`)
    await expect(page.getByRole('form', { name: 'AI agent settings' }).getByText(/Last saved/)).toBeVisible()

    // An FAQ starts as a draft and reaches the agent only once approved.
    await page.getByRole('button', { name: 'Add FAQ' }).click()
    const dialog = page.getByRole('dialog', { name: 'Add FAQ' })
    await dialog.getByLabel(/Question/).fill(`Where do visitors park ${marker}?`)
    await dialog.getByLabel(/Answer/).fill('Basement level P2.')
    await dialog.getByRole('button', { name: 'Add as draft' }).click()
    const faqs = page.getByRole('list', { name: 'FAQs' })
    const item = faqs.getByRole('listitem').filter({ hasText: `Where do visitors park ${marker}?` })
    await expect(item).toContainText('Not available to the agent until approved')
    await item.getByRole('button', { name: `Approve Where do visitors park ${marker}?` }).click()
    await expect(item).toContainText(`Approved by ${e2eUser('admin').fullName}`)
  })

  test('other members see the agent read-only', async ({ page }) => {
    await signIn(page, e2eUser('readOnly'), '/settings/integrations/whatsapp/agent')
    await expectShell(page)
    await expect(pageHeading(page)).toHaveText('AI agent')
    await expect(page.getByText(/Only company admins can change or approve them/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save AI agent settings' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Add FAQ' })).toHaveCount(0)
  })
})
