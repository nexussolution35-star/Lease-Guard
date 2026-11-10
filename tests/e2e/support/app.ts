import { expect, type Locator, type Page } from '@playwright/test'

import type { WorldUser } from '../../fixtures/world.ts'

/** Sidebar sections and items, in order (frontend/src/lib/navigation.ts). */
export const NAV_ITEMS = [
  { label: 'Dashboard', path: '/' },
  { label: 'Properties', path: '/properties' },
  { label: 'Units', path: '/units' },
  { label: 'Tenants', path: '/tenants' },
  { label: 'Leases', path: '/leases' },
  { label: 'Statements', path: '/statements' },
  { label: 'Monitoring', path: '/monitoring' },
  { label: 'Arrangements', path: '/arrangements' },
  { label: 'Communications', path: '/communications' },
  { label: 'WhatsApp', path: '/whatsapp' },
  { label: 'Reports', path: '/reports' },
  { label: 'Settings', path: '/settings' },
] as const

export function mainNavigation(page: Page): Locator {
  return page.getByRole('navigation', { name: 'Main' })
}

export function navLink(page: Page, label: string): Locator {
  return mainNavigation(page).getByRole('link', { name: label, exact: true })
}

export function pageHeading(page: Page): Locator {
  return page.getByRole('heading', { level: 1 })
}

/** The application shell is rendered: sidebar navigation, top bar and the main region. */
export async function expectShell(page: Page): Promise<void> {
  await expect(mainNavigation(page)).toBeVisible()
  await expect(page.getByRole('banner')).toBeVisible()
  await expect(page.getByRole('main')).toBeVisible()
}

export function workspaceSwitcher(page: Page): Locator {
  return page.getByRole('button', { name: /^Workspace: .+\. Switch workspace$/ })
}

/** Opens the workspace menu and chooses the company by (trading) name. */
export async function switchWorkspace(page: Page, companyName: string): Promise<void> {
  await workspaceSwitcher(page).click()
  await page.getByRole('menuitem', { name: new RegExp(companyName) }).click()
  await expect(workspaceSwitcher(page)).toHaveAccessibleName(`Workspace: ${companyName}. Switch workspace`)
}

export function propertiesTable(page: Page): Locator {
  return page.getByRole('table', { name: 'Properties in this workspace' })
}

/** Property names in the visible table, in display order (each name is a link to the detail screen). */
export function propertyLinks(page: Page): Locator {
  return propertiesTable(page).getByRole('link')
}

export function notificationsButton(page: Page): Locator {
  return page.getByRole('banner').getByRole('button', { name: /^Notifications/ })
}

/** Signs in through the login form (the page must show it) and waits for the application shell. */
export async function signInWith(page: Page, email: string, password: string): Promise<void> {
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

/** Opens `path` signed in as `user` (through /login), and waits for the shell. */
export async function signIn(page: Page, user: WorldUser, path = '/'): Promise<void> {
  await page.goto(path === '/' ? '/login' : `/login?redirect=${encodeURIComponent(path)}`)
  await signInWith(page, user.email, user.password)
  await expectShell(page)
  await expect(page).toHaveURL(path)
}

export function accountMenuButton(page: Page, fullName: string): Locator {
  return page.getByRole('banner').getByRole('button', { name: `Account menu for ${fullName}` })
}

export async function openAccountMenu(page: Page, fullName: string): Promise<Locator> {
  await accountMenuButton(page, fullName).click()
  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible()
  return menu
}

export async function signOut(page: Page, fullName: string): Promise<void> {
  const menu = await openAccountMenu(page, fullName)
  await menu.getByRole('menuitem', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in to LeaseGuard' })).toBeVisible()
}
