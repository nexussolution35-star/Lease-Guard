import { expect, test } from '@playwright/test'

import { serviceRoleClient } from '../fixtures/world.ts'
import { pageHeading, signIn } from './support/app.ts'
import { e2eContext, e2eUser, e2eWorld } from './support/world.ts'

/**
 * Communication analytics (ticket 12): a read-only member of company A opens the figures for a past day on which A
 * received two WhatsApp messages and B one (inserted the way the webhook worker records them), sees only A's, and
 * changes the range with a quick range.
 */
test.describe('Communication analytics', () => {
  test("a member sees their own company's figures for a day and changes the range", async ({ page }) => {
    const db = serviceRoleClient(e2eContext().supabase)
    const marker = Date.now().toString(36)
    const day = '2021-03-03'
    const inbound = (company: 'a' | 'b', n: number) => {
      const c = e2eWorld().companies[company]
      const tenant = c.tenants[0]!
      return {
        company_id: c.id,
        channel: 'whatsapp' as const,
        direction: 'inbound' as const,
        message_type: 'inbound_reply' as const,
        recipient_type: 'tenant' as const,
        tenant_id: tenant.id,
        counterparty_number: tenant.whatsappNumber,
        company_number: '+27 11 555 0100',
        body: `Thank you (e2e ${marker})`,
        status: 'received' as const,
        external_message_id: `wamid.e2e-analytics-${marker}-${company}${n}`,
        created_at: `${day}T09:00:00+02:00`,
      }
    }
    const inserted = await db.from('communications').insert([inbound('a', 1), inbound('a', 2), inbound('b', 1)]).select('id')
    if (inserted.error) throw new Error(`messages: ${inserted.error.message}`)
    const ids = (inserted.data as { id: string }[]).map((row) => row.id)
    try {
      await signIn(page, e2eUser('readOnly'), `/communications/analytics?from=${day}&to=${day}`)
      await expect(pageHeading(page)).toHaveText('Communication analytics')
      await expect(page.getByText('03 Mar 2021 to 03 Mar 2021')).toBeVisible()
      const messages = page.getByRole('region', { name: 'Messages' })
      await expect(messages.locator('div.flex-col').filter({ hasText: 'Received' })).toContainText('2')
      await expect(messages.locator('div.flex-col').filter({ hasText: 'Sent' })).toContainText('0')

      await page.getByRole('button', { name: 'Last 7 days' }).click()
      await expect(page).toHaveURL(/from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}/)
      await expect(page.getByRole('button', { name: 'Last 7 days' })).toHaveAttribute('aria-pressed', 'true')
      await expect(page.getByText('03 Mar 2021 to 03 Mar 2021')).toHaveCount(0)

      // The dashboard summarises the last 30 days for every member and links here.
      await page.goto('/')
      const summary = page.getByRole('region', { name: 'WhatsApp activity' })
      await expect(summary).toBeVisible()
      await summary.getByRole('link', { name: 'Open communication analytics' }).click()
      await expect(pageHeading(page)).toHaveText('Communication analytics')
    } finally {
      await db.from('communications').delete().in('id', ids)
    }
  })
})
