import { expect, test } from '@playwright/test'

import { serviceRoleClient } from '../fixtures/world.ts'
import { expectShell, pageHeading, signIn } from './support/app.ts'
import { e2eContext, e2eUser, e2eWorld } from './support/world.ts'

// Module 1 settings: company details, notice periods, roles and the audit log. The admin test changes
// company A's VAT number and lease expiry notices, and puts both back.
test.describe.configure({ mode: 'serial' })

test.describe('Settings → Company, Notifications, Roles and Audit log', () => {
  const company = () => e2eWorld().companies.a

  test.afterAll(async () => {
    const db = serviceRoleClient(e2eContext().supabase)
    await db.from('companies').update({ vat_number: null, lease_expiry_notice_days: [180, 90, 30] }).eq('id', company().id)
  })

  test('a company admin changes the company details and the notice periods, and both reach the audit log', async ({ page }) => {
    await signIn(page, e2eUser('admin'), '/settings/company')
    await expect(pageHeading(page)).toHaveText('Company')

    const details = page.getByRole('form', { name: 'Company details' })
    await expect(details.getByLabel(/Registered name/)).toHaveValue(company().name)
    await details.getByLabel('VAT number').fill('4123456789')
    await details.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByText('Company details saved')).toBeVisible()

    await details.getByLabel(/Postal code/).fill('21')
    await details.getByRole('button', { name: 'Save changes' }).click()
    await expect(details.getByText('Enter the four-digit postal code')).toBeVisible()

    await page.getByRole('navigation', { name: 'Settings' }).getByRole('link', { name: 'Notifications' }).click()
    await expect(pageHeading(page)).toHaveText('Notifications')
    const timing = page.getByRole('form', { name: 'Notice periods and reminder timing' })
    await timing.getByLabel(/Lease expiry notices/).fill('365, 180, 90')
    await timing.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByText('Settings saved')).toBeVisible()
    await expect(page.getByText(/Every tenant message needs a property manager's approval/)).toBeVisible()

    await page.getByRole('navigation', { name: 'Settings' }).getByRole('link', { name: 'Audit log' }).click()
    await expect(pageHeading(page)).toHaveText('Audit log')
    const entries = page.getByRole('table', { name: 'Audit log entries, newest first' })
    const byAdmin = entries.getByRole('row').filter({ hasText: e2eUser('admin').fullName })
    await expect(byAdmin.filter({ hasText: 'Company details updated' })).toBeVisible()
    const settingsRow = byAdmin.filter({ hasText: 'Notice periods and reminder timing updated' })
    await settingsRow.getByText('1 field changed').click()
    await expect(settingsRow).toContainText('Lease expiry notice days: 180, 90, 30')
    await expect(settingsRow).toContainText('365, 180, 90')
  })

  test('a read-only member reads the settings and the audit log, and can change nothing', async ({ page }) => {
    await signIn(page, e2eUser('readOnly'), '/settings/company')
    await expectShell(page)
    await expect(page.getByText(/Only company admins can change them/)).toBeVisible()
    await expect(page.getByText(company().name).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0)

    await page.goto('/settings/notifications')
    await expect(pageHeading(page)).toHaveText('Notifications')
    await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0)

    await page.goto('/settings/roles')
    await expect(page.getByRole('columnheader', { name: /Read only\s*\(your role\)/ })).toBeVisible()

    await page.goto('/settings/audit')
    await expect(pageHeading(page)).toHaveText('Audit log')
    await expect(page.getByRole('group', { name: 'Filter the audit log' })).toBeVisible()
  })

  test('a property owner is told the audit log is not for their role', async ({ page }) => {
    await signIn(page, e2eUser('owner'), '/settings/audit')
    await expect(page.getByText('The audit log is not available for your role')).toBeVisible()
  })
})
