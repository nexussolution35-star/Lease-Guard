import { expect, test, type Locator, type Page } from '@playwright/test'

import { serviceRoleClient } from '../fixtures/world.ts'
import { accountMenuButton, openAccountMenu, signIn, signInWith, signOut } from './support/app.ts'
import { E2E_WEB_URL } from './support/env.ts'
import { e2eContext, e2eUser } from './support/world.ts'

interface StoredProfile {
  full_name: string
  phone: string | null
  whatsapp_number: string | null
  job_title: string | null
}

/** The profile row as stored, read with the service role (LOCAL stack only). */
async function storedProfile(userId: string): Promise<StoredProfile> {
  const db = serviceRoleClient(e2eContext().supabase)
  const { data, error } = await db.from('profiles').select('full_name, phone, whatsapp_number, job_title').eq('id', userId).single()
  if (error || !data) throw new Error(`Reading profile ${userId} failed: ${error?.message ?? 'no row'}`)
  return data as StoredProfile
}

async function openEditProfile(page: Page, fullName: string): Promise<Locator> {
  const menu = await openAccountMenu(page, fullName)
  await menu.getByRole('menuitem', { name: 'Edit profile' }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit profile' })
  await expect(dialog).toBeVisible()
  return dialog
}

async function fillProfile(dialog: Locator, values: { fullName: string; jobTitle: string; phone: string; whatsapp: string }) {
  await dialog.getByLabel('Full name').fill(values.fullName)
  await dialog.getByLabel('Job title').fill(values.jobTitle)
  await dialog.getByLabel('Phone').fill(values.phone)
  await dialog.getByLabel('WhatsApp number').fill(values.whatsapp)
  await dialog.getByRole('button', { name: 'Save changes' }).click()
}

test.describe('account menu: profile management', () => {
  // Each test uses its own world user, so tests running in parallel never see each other's changes.
  test('shows the user, their email and their role in the active company', async ({ page }) => {
    const user = e2eUser('owner')
    await signIn(page, user)
    const menu = await openAccountMenu(page, user.fullName)
    await expect(menu.getByText(user.email)).toBeVisible()
    await expect(menu.getByText(/^Property owner · /)).toBeVisible()
    for (const item of ['Edit profile', 'Change password', 'Theme', 'Sign out']) {
      await expect(menu.getByRole('menuitem', { name: item })).toBeVisible()
    }
    // A single membership: nothing to switch to.
    await expect(menu.getByRole('menuitem', { name: 'Switch workspace' })).toHaveCount(0)
  })

  test('edits the profile through PATCH /me and restores it', async ({ page }) => {
    const user = e2eUser('admin')
    const original = await storedProfile(user.id)
    await signIn(page, user)

    // Invalid input is refused before anything is sent.
    const invalid = await openEditProfile(page, user.fullName)
    await invalid.getByLabel('WhatsApp number').fill('12345')
    await invalid.getByRole('button', { name: 'Save changes' }).click()
    await expect(invalid.getByText('Enter an international number such as +27 82 123 4567')).toBeVisible()
    await invalid.getByRole('button', { name: 'Cancel' }).click()
    expect(await storedProfile(user.id)).toEqual(original)

    const changed = { fullName: `${user.fullName} Edited`, jobTitle: 'Head of Leasing', phone: '011 555 0199', whatsapp: '083 555 0199' }
    await fillProfile(await openEditProfile(page, user.fullName), changed)
    await expect(page.getByText('Profile updated')).toBeVisible()
    await expect(accountMenuButton(page, changed.fullName)).toBeVisible()
    expect(await storedProfile(user.id)).toEqual({
      full_name: changed.fullName,
      phone: changed.phone,
      whatsapp_number: '+27835550199',
      job_title: changed.jobTitle,
    })

    // Clearing an optional field removes it.
    const dialog = await openEditProfile(page, changed.fullName)
    await dialog.getByLabel('Job title').fill('')
    await dialog.getByRole('button', { name: 'Save changes' }).click()
    await expect(dialog).toBeHidden()
    expect((await storedProfile(user.id)).job_title).toBeNull()

    // Edit back to the original values.
    await fillProfile(await openEditProfile(page, changed.fullName), {
      fullName: original.full_name,
      jobTitle: original.job_title ?? '',
      phone: original.phone ?? '',
      whatsapp: original.whatsapp_number ?? '',
    })
    await expect(accountMenuButton(page, original.full_name)).toBeVisible()
    expect(await storedProfile(user.id)).toEqual(original)
  })
})

/**
 * The password link Supabase would email, generated with the service role (LOCAL stack only; local
 * email capture is off). A new recovery link replaces the one the app's request emailed.
 */
async function passwordLink(email: string): Promise<string> {
  const admin = serviceRoleClient(e2eContext().supabase).auth.admin
  const { data, error } = await admin.generateLink({
    type: 'recovery',
    email,
    options: { redirectTo: `${E2E_WEB_URL}/auth/reset-password` },
  })
  const link = data.properties?.action_link
  if (error || !link) throw new Error(`Generating a recovery link for ${email} failed: ${error?.message ?? 'no link'}`)
  return link
}

test.describe('account menu: change password by email link', () => {
  /** Requests the link from the account menu, as the user would. */
  async function requestLink(page: Page, fullName: string, email: string): Promise<void> {
    const menu = await openAccountMenu(page, fullName)
    await menu.getByRole('menuitem', { name: 'Change password' }).click()
    const dialog = page.getByRole('dialog', { name: 'Change password' })
    // No password fields: the new password is only chosen from the emailed link.
    await expect(dialog.getByLabel(/password/i)).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Send link' }).click()
    await expect(dialog.getByText(`We sent a link to ${email}`)).toBeVisible()
    await expect(dialog.getByRole('button', { name: /^Resend link in \d+s$/ })).toBeDisabled()
    await dialog.getByRole('button', { name: 'Done' }).click()
    await expect(dialog).toBeHidden()
  }

  /** Opens the password link and sets `password`; the app continues signed in. */
  async function setPasswordFromLink(page: Page, email: string, password: string): Promise<void> {
    await page.goto(await passwordLink(email))
    await expect(page).toHaveURL(/\/auth\/reset-password/)
    await expect(page.getByRole('heading', { level: 1, name: 'Set a new password' })).toBeVisible()
    await page.getByLabel(/^New password/).fill(password)
    await page.getByLabel('Confirm new password').fill(password)
    await page.getByRole('button', { name: 'Save new password' }).click()
    await expect(page.getByText('Password updated')).toBeVisible()
    await expect(page).toHaveURL('/')
  }

  test('sends a link from the menu, sets a new password from it, and changes it back', async ({ page }) => {
    const user = e2eUser('readOnly')
    const temporary = `${user.password}-changed`
    await signIn(page, user)

    await requestLink(page, user.fullName, user.email)
    await setPasswordFromLink(page, user.email, temporary)
    await expect(accountMenuButton(page, user.fullName)).toBeVisible()

    // The old password no longer works; the new one does.
    await signOut(page, user.fullName)
    await signInWith(page, user.email, user.password)
    await expect(page.getByText('The email address or password is incorrect.')).toBeVisible()
    await signInWith(page, user.email, temporary)
    await expect(accountMenuButton(page, user.fullName)).toBeVisible()

    // Restore the original password the same way and prove it signs in again.
    await requestLink(page, user.fullName, user.email)
    await setPasswordFromLink(page, user.email, user.password)
    await signOut(page, user.fullName)
    await signInWith(page, user.email, user.password)
    await expect(accountMenuButton(page, user.fullName)).toBeVisible()
  })
})
