import { screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { useAppStore } from '@/store/appStore'

import { Breadcrumbs } from './Breadcrumbs'
import { renderWithRouter } from './testRouter'

beforeEach(() => {
  localStorage.clear()
  useAppStore.getState().resetDemoData()
})

describe('Breadcrumbs', () => {
  it('derives the trail from the current route', async () => {
    await renderWithRouter(<Breadcrumbs />, '/statements/upload')
    const nav = await screen.findByRole('navigation', { name: /breadcrumb/i })
    expect(within(nav).getByRole('link', { name: 'Statements' })).toHaveAttribute('href', '/statements')
    expect(within(nav).getByText('Upload')).toHaveAttribute('aria-current', 'page')
  })

  it('resolves record names for detail routes in the active workspace', async () => {
    const property = Object.values(useAppStore.getState().collections.properties).find(
      (p) => p.companyId === useAppStore.getState().workspace.activeCompanyId,
    )
    expect(property).toBeDefined()
    await renderWithRouter(<Breadcrumbs />, `/properties/${property?.id ?? ''}`)
    expect(await screen.findByText(property?.name ?? '')).toBeInTheDocument()
  })

  it('renders an explicit trail', async () => {
    await renderWithRouter(<Breadcrumbs items={[{ label: 'Leases', to: '/leases' }, { label: 'LSE-001' }]} />, '/')
    expect(await screen.findByRole('link', { name: 'Leases' })).toHaveAttribute('href', '/leases')
    expect(screen.getByText('LSE-001')).toBeInTheDocument()
  })
})
