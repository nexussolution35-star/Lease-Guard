import { screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithRouter } from '@/components/layout/testRouter'

import { RolesSettingsScreen } from './RolesSettingsScreen'

const viewer = vi.hoisted(() => ({ role: 'property_manager' as 'company_admin' | 'property_manager' | 'property_owner' | 'read_only' }))
vi.mock('@/features/account/useActiveRole', () => ({
  useActiveRole: () => viewer.role,
  useIsCompanyAdmin: () => viewer.role === 'company_admin',
}))

function cells(rowName: RegExp) {
  const row = screen.getByRole('row', { name: rowName })
  return within(row)
    .getAllByRole('cell')
    .map((cell) => cell.textContent)
}

beforeEach(() => {
  viewer.role = 'property_manager'
})

describe('RolesSettingsScreen', () => {
  it('describes every role and marks the signed-in user’s role', async () => {
    await renderWithRouter(<RolesSettingsScreen />, '/settings/roles')
    for (const role of ['Company admin', 'Property manager', 'Property owner', 'Read only']) {
      expect(screen.getByRole('columnheader', { name: new RegExp(role) })).toBeInTheDocument()
    }
    expect(screen.getAllByText('Your role')).toHaveLength(1)
    expect(screen.getByRole('columnheader', { name: /Property manager\s*\(your role\)/ })).toBeInTheDocument()
  })

  it('shows who may do what, in words', async () => {
    await renderWithRouter(<RolesSettingsScreen />, '/settings/roles')
    // Columns: company admin, property manager, property owner, read only.
    expect(cells(/Approve or reject tenant messages/)).toEqual(['Yes', 'Yes', 'No', 'No'])
    expect(cells(/Invite people, change roles and remove members/)).toEqual(['Yes', 'No', 'No', 'No'])
    expect(cells(/View the audit log/)).toEqual(['Yes', 'Yes', 'No', 'Yes'])
    expect(cells(/View properties, units, tenants/)).toEqual(['Yes', 'Yes', 'Yes', 'Yes'])
  })

  it('points company admins to Settings → Users, and others to their admin', async () => {
    const view = await renderWithRouter(<RolesSettingsScreen />, '/settings/roles')
    expect(screen.getByText(/A company admin can change your role/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Settings → Users' })).not.toBeInTheDocument()
    view.unmount()

    viewer.role = 'company_admin'
    await renderWithRouter(<RolesSettingsScreen />, '/settings/roles')
    expect(screen.getByRole('link', { name: 'Settings → Users' })).toHaveAttribute('href', '/settings/users')
  })
})
