import { expect, test } from '@playwright/test'

import { serviceRoleClient } from '../fixtures/world.ts'
import { expectShell, pageHeading, signIn } from './support/app.ts'
import { e2eContext, e2eUser, e2eWorld } from './support/world.ts'

// Invites someone to company A and revokes it; the test removes what it added.
test.describe.configure({ mode: 'serial' })

const inviteePattern = (marker: string) => `invitee-${marker}@leaseguard.test`

test.describe('Settings → Users', () => {
  const markers: string[] = []

  test.afterAll(async () => {
    const db = serviceRoleClient(e2eContext().supabase)
    for (const marker of markers) await db.from('company_invitations').delete().eq('email', inviteePattern(marker))
  })

  test('a company admin invites a user, sees the invitation and revokes it; their own row is protected', async ({ page }) => {
    const marker = `${Date.now().toString(36)}.${e2eWorld().runId}`
    markers.push(marker)
    const email = inviteePattern(marker)
    const admin = e2eUser('admin')

    await signIn(page, admin, '/settings/users')
    await expect(pageHeading(page)).toHaveText('Users')

    const members = page.getByRole('table', { name: 'Members of this workspace' })
    const self = members.getByRole('row').filter({ hasText: admin.email })
    await expect(self).toContainText('You')
    await expect(self.getByRole('button', { name: `Change role for ${admin.fullName}` })).toBeDisabled()
    await expect(self.getByRole('button', { name: `Remove ${admin.fullName}` })).toBeDisabled()
    await expect(self).toContainText('You cannot change your own role or remove yourself')

    await page.getByRole('button', { name: 'Invite user' }).first().click()
    const dialog = page.getByRole('dialog', { name: 'Invite user' })
    await dialog.getByLabel(/Email address/).fill(email)
    await dialog.getByLabel(/Name/).fill('Lerato Invitee')
    await dialog.getByRole('button', { name: 'Send invitation' }).click()
    await expect(page.getByText(`Invitation for ${email} created`)).toBeVisible()

    const invitations = page.getByRole('table', { name: 'Invitations to this workspace' })
    const row = invitations.getByRole('row').filter({ hasText: email })
    await expect(row).toContainText('Property manager')

    // The same email again is a conflict, shown on the email field.
    await page.getByRole('button', { name: 'Invite user' }).first().click()
    await dialog.getByLabel(/Email address/).fill(email)
    await dialog.getByRole('button', { name: 'Send invitation' }).click()
    await expect(dialog.getByText(/already has an open invitation/)).toBeVisible()
    await dialog.getByRole('button', { name: 'Cancel' }).click()

    await row.getByRole('button', { name: `Revoke invitation to ${email}` }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Revoke invitation' }).click()
    await expect(page.getByText(`The invitation to ${email} was revoked. It can no longer be accepted.`)).toBeVisible()
    await expect(row).toContainText('Revoked')
    await expect(row.getByRole('button', { name: `Revoke invitation to ${email}` })).toBeDisabled()
  })

  test('other members see a read-only member list', async ({ page }) => {
    await signIn(page, e2eUser('readOnly'), '/settings/users')
    await expectShell(page)
    await expect(pageHeading(page)).toHaveText('Users')
    await expect(page.getByText(/Only company admins can invite people, change roles or remove members/)).toBeVisible()
    await expect(page.getByRole('table', { name: 'Members of this workspace' }).getByRole('row').filter({ hasText: e2eUser('admin').email })).toContainText(
      'Company admin',
    )
    await expect(page.getByRole('button', { name: 'Invite user' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^Change role for/ })).toHaveCount(0)
    await expect(page.getByRole('table', { name: 'Invitations to this workspace' })).toHaveCount(0)
  })
})
