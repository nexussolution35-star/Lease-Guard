import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { routeTree } from '@/routeTree.gen'
import { useAppStore } from '@/store/appStore'

async function renderApp(path: string) {
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [path] }) })
  await router.load()
  render(<RouterProvider router={router} />)
  return router
}

function propertyOf(companyId: string) {
  return Object.values(useAppStore.getState().collections.properties).find((p) => p.companyId === companyId)
}

beforeEach(() => {
  localStorage.clear()
  useAppStore.getState().resetDemoData()
})

describe('app routes', () => {
  it('renders a screen inside the application shell', async () => {
    await renderApp('/leases')
    expect(await screen.findByRole('heading', { level: 1, name: 'Leases' })).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect(within(nav).getByRole('link', { name: /^leases/i, current: 'page' })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: /dashboard/i })).not.toHaveAttribute('aria-current')
  })

  it('shows a detail record from the active workspace', async () => {
    const own = propertyOf(useAppStore.getState().workspace.activeCompanyId)
    await renderApp(`/properties/${own?.id ?? ''}`)
    expect(await screen.findByRole('heading', { level: 1, name: own?.name ?? '' })).toBeInTheDocument()
  })

  it('does not show records from another workspace', async () => {
    const other = propertyOf('cmp_kgalagadi')
    expect(other).toBeDefined()
    await renderApp(`/properties/${other?.id ?? ''}`)
    expect(await screen.findByText('Property not found in this workspace')).toBeInTheDocument()
  })

  it('redirects /settings to /settings/company', async () => {
    const router = await renderApp('/settings')
    expect(router.state.location.pathname).toBe('/settings/company')
    expect(await screen.findByRole('heading', { level: 1, name: 'Company' })).toBeInTheDocument()
  })

  it('renders not found inside the shell for unknown paths', async () => {
    await renderApp('/does-not-exist')
    expect(await screen.findByText('Page not found')).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
  })
})
