import { expect, test, type Page } from '@playwright/test'

import { serviceRoleClient } from '../fixtures/world.ts'
import { expectShell, pageHeading, signIn, switchWorkspace } from './support/app.ts'
import { e2eContext, e2eUser, e2eWorld } from './support/world.ts'

type CompanyKey = 'a' | 'b'

function throwOn(what: string, result: { error: { message: string } | null }): void {
  if (result.error) throw new Error(`${what}: ${result.error.message}`)
}

/**
 * Inserts a monthly statement message to the company's first tenant, awaiting approval, the way the statement
 * workflow records one (no worker runs in e2e). Returns the message id; removed in the test's finally.
 */
async function createPendingStatementMessage(company: CompanyKey, body: string, counterpartyNumber?: string): Promise<string> {
  const db = serviceRoleClient(e2eContext().supabase)
  const companyId = e2eWorld().companies[company].id
  const tenant = e2eWorld().companies[company].tenants[0]
  if (!tenant) throw new Error(`The e2e world has no tenant in company ${company}`)
  const requester = e2eUser('manager').id
  const inserted = await db
    .from('communications')
    .insert({
      company_id: companyId,
      channel: 'whatsapp',
      direction: 'outbound',
      message_type: 'monthly_statement',
      recipient_type: 'tenant',
      tenant_id: tenant.id,
      counterparty_number: counterpartyNumber ?? tenant.whatsappNumber,
      company_number: '+27 12 555 0300',
      body,
      status: 'pending_approval',
      created_by_user_id: requester,
    })
    .select('id')
    .single()
  throwOn('message', inserted)
  const id = (inserted.data as { id: string }).id
  throwOn('approval request', await db.from('message_approvals').insert({ company_id: companyId, communication_id: id, requested_by_user_id: requester }))
  return id
}

function pendingMessage(page: Page, body: string) {
  return page.getByRole('article').filter({ hasText: body })
}

// No worker and no Meta run in e2e: an approved message stays queued for delivery. Company B is used for the decision
// flow so the WhatsApp settings tests (company A, which must start with no number) are not disturbed.
test.describe('Message approvals', () => {
  test('a property manager sees why a message cannot be sent, approves a deliverable one and rejects with a reason', async ({ page }) => {
    const db = serviceRoleClient(e2eContext().supabase)
    const b = e2eWorld().companies.b
    const tenant = b.tenants[0]!
    const unique = `${Date.now()}`
    // Letters in the marker: a long run of digits in the text reads as banking details, which delivery refuses.
    const marker = Date.now().toString(36)
    const blockedBody = `Good day. Your October 2026 statement is ready. (e2e blocked ${marker})`
    const deliverableBody = `Good day. Your November 2026 statement is ready. (e2e deliverable ${marker})`
    const ids = { account: `${unique}5`, phone: `${unique}6` }
    const messages: string[] = []
    try {
      // Addressed to a number that is no longer the tenant's: delivery would refuse it whatever the channel.
      const staleNumber = tenant.whatsappNumber.replace(/\d$/, (digit) => String((Number(digit) + 5) % 10))
      messages.push(await createPendingStatementMessage('b', blockedBody, staleNumber))
      messages.push(await createPendingStatementMessage('b', deliverableBody))
      // Company B's connected number, as the worker records it after Embedded Signup and verification.
      throwOn('account', await db.from('whatsapp_business_accounts').insert({ company_id: b.id, business_account_id: ids.account }))
      throwOn(
        'number',
        await db.from('whatsapp_phone_numbers').insert({
          company_id: b.id,
          business_account_id: ids.account,
          phone_number_id: ids.phone,
          display_name: '',
          display_number: '+27 12 555 0300',
          connection_status: 'connected',
        }),
      )

      await signIn(page, e2eUser('manager'), '/communications/approvals')
      await expectShell(page)
      await switchWorkspace(page, b.tradingName)
      await expect(pageHeading(page)).toHaveText('Message approvals')

      // Blocked: every reason is shown on the message, which stays pending.
      const blocked = pendingMessage(page, blockedBody)
      await expect(blocked).toContainText(tenant.tradingName)
      await blocked.getByRole('button', { name: 'Approve' }).click()
      await page.getByRole('dialog', { name: 'Approve message' }).getByRole('button', { name: 'Approve and send' }).click()
      const blockers = blocked.getByRole('alert')
      await expect(blockers).toContainText('This message cannot be sent yet')
      await expect(blockers.getByRole('listitem')).toContainText([
        "The tenant's WhatsApp number is no longer the number this message is addressed to; create a new message",
      ])
      await expect(blocked.getByRole('button', { name: 'Approve' })).toBeVisible()

      // Deliverable: approved, queued and gone from the queue.
      const deliverable = pendingMessage(page, deliverableBody)
      await deliverable.getByRole('button', { name: 'Approve' }).click()
      const approve = page.getByRole('dialog', { name: 'Approve message' })
      await approve.getByLabel('Note').fill('Checked against the November statement')
      await approve.getByRole('button', { name: 'Approve and send' }).click()
      await expect(page.getByText('Message approved and queued for sending')).toBeVisible()
      await expect(deliverable).toHaveCount(0)

      // The blocked one is rejected with a reason; a reason is required.
      await blocked.getByRole('button', { name: 'Reject' }).click()
      const reject = page.getByRole('dialog', { name: 'Reject message' })
      await reject.getByRole('button', { name: 'Reject message' }).click()
      await expect(reject.getByText('Give a reason for rejecting the message')).toBeVisible()
      await reject.getByLabel(/Reason/).fill('Addressed to an old number')
      await reject.getByRole('button', { name: 'Reject message' }).click()
      await expect(page.getByText('Message rejected')).toBeVisible()
      await expect(blocked).toHaveCount(0)

      const decided = await db.from('message_approvals').select('communication_id, decision, reason').in('communication_id', messages)
      throwOn('decisions', decided)
      expect(decided.data).toEqual(
        expect.arrayContaining([
          { communication_id: messages[0], decision: 'rejected', reason: 'Addressed to an old number' },
          { communication_id: messages[1], decision: 'approved', reason: 'Checked against the November statement' },
        ]),
      )
    } finally {
      if (messages.length > 0) await db.from('communications').delete().in('id', messages)
      await db.from('whatsapp_phone_numbers').delete().eq('phone_number_id', ids.phone)
      await db.from('whatsapp_business_accounts').delete().eq('business_account_id', ids.account)
    }
  })

  test('a read-only member sees what is waiting but cannot approve or reject', async ({ page }) => {
    const db = serviceRoleClient(e2eContext().supabase)
    const body = `Good day. Your October 2026 statement is ready. (e2e read-only ${Date.now().toString(36)})`
    const messages: string[] = []
    try {
      messages.push(await createPendingStatementMessage('a', body))
      await signIn(page, e2eUser('readOnly'), '/communications/approvals')
      await expect(pageHeading(page)).toHaveText('Message approvals')
      const pending = pendingMessage(page, body)
      await expect(pending).toBeVisible()
      await expect(page.getByText('Only company admins and property managers can approve or reject messages.', { exact: false })).toBeVisible()
      await expect(pending.getByRole('button', { name: 'Approve' })).toHaveCount(0)
      await expect(pending.getByRole('button', { name: 'Reject' })).toHaveCount(0)
    } finally {
      if (messages.length > 0) await db.from('communications').delete().in('id', messages)
    }
  })
})
