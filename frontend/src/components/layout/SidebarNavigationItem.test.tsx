import { screen } from '@testing-library/react'
import { Building2 } from 'lucide-react'
import { describe, expect, it } from 'vitest'

import { SidebarNavigationItem } from './SidebarNavigationItem'
import { renderWithRouter } from './testRouter'

const item = { id: 'properties', label: 'Properties', to: '/properties', icon: Building2 }

describe('SidebarNavigationItem', () => {
  it('marks the active item with aria-current="page"', async () => {
    await renderWithRouter(<SidebarNavigationItem item={item} active />, '/properties')
    const link = await screen.findByRole('link', { name: /properties/i })
    expect(link).toHaveAttribute('aria-current', 'page')
    expect(link).toHaveAttribute('href', '/properties')
  })

  it('does not mark inactive items', async () => {
    await renderWithRouter(<SidebarNavigationItem item={item} active={false} />, '/leases')
    const link = await screen.findByRole('link', { name: /properties/i })
    expect(link).not.toHaveAttribute('aria-current')
  })

  it('uses the label as the accessible name and hides the text when collapsed', async () => {
    await renderWithRouter(<SidebarNavigationItem item={item} active={false} collapsed />, '/')
    const link = await screen.findByRole('link', { name: 'Properties' })
    expect(link).not.toHaveTextContent('Properties')
  })
})
