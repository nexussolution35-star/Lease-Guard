import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setSidebarCollapsed, SIDEBAR_COLLAPSED_STORAGE_KEY, useSidebarCollapsed } from '@/components/layout/useSidebarCollapsed'
import { ThemeSubMenu } from '@/components/layout/ThemeSubMenu'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { setThemePreference, THEME_STORAGE_KEY } from '@/lib/theme'

import { PreferencesScreen } from './PreferencesScreen'

/** The sidebar's own toggle, as the app shell uses it. */
function SidebarToggle() {
  const [collapsed, toggle] = useSidebarCollapsed()
  return (
    <button type="button" onClick={toggle}>
      {collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
    </button>
  )
}

beforeEach(() => {
  localStorage.clear()
  setThemePreference('system')
  setSidebarCollapsed(false)
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('PreferencesScreen', () => {
  it('says the preferences are kept in this browser only and lists what follows the system', () => {
    render(<PreferencesScreen />)
    expect(screen.getByText(/saved in this browser only/i)).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByText('Motion')).toBeInTheDocument()
    expect(screen.getByText(/South African format/)).toHaveTextContent(/\d{2} [A-Z][a-z]{2} \d{4}/)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('applies a theme at once, remembers it and clears the stored choice for System', async () => {
    render(<PreferencesScreen />)
    const group = screen.getByRole('radiogroup', { name: 'Theme' })
    expect(within(group).getByRole('radio', { name: /System/ })).toBeChecked()

    await userEvent.click(within(group).getByRole('radio', { name: /Dark/ }))
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')

    await userEvent.click(within(group).getByRole('radio', { name: /System/ }))
    expect(document.documentElement).not.toHaveAttribute('data-theme')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull()
  })

  it('stays in sync with the account menu theme switch', async () => {
    render(
      <>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger>Account</DropdownMenuTrigger>
          <DropdownMenuContent>
            <ThemeSubMenu />
          </DropdownMenuContent>
        </DropdownMenu>
        <PreferencesScreen />
      </>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Account' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Theme' }))
    await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Light' }))

    expect(screen.getByRole('radio', { name: /Light/ })).toBeChecked()
    expect(document.documentElement).toHaveAttribute('data-theme', 'light')
  })

  it('retracts the sidebar at once, in step with the sidebar toggle, and remembers it', async () => {
    render(
      <>
        <SidebarToggle />
        <PreferencesScreen />
      </>,
    )
    const toggle = screen.getByRole('switch', { name: 'Start with the sidebar retracted' })
    expect(toggle).not.toBeChecked()

    await userEvent.click(toggle)
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument()
    expect(localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY)).toBe('true')

    await userEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }))
    expect(toggle).not.toBeChecked()
    expect(localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY)).toBe('false')
  })

  it('still applies preferences for the session when storage is unavailable, and says so', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError')
    })
    render(<PreferencesScreen />)
    expect(screen.getByRole('status')).toHaveTextContent(/not saving preferences/i)

    await userEvent.click(screen.getByRole('radio', { name: /Dark/ }))
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    expect(screen.getByRole('radio', { name: /Dark/ })).toBeChecked()

    await userEvent.click(screen.getByRole('switch', { name: 'Start with the sidebar retracted' }))
    expect(screen.getByRole('switch', { name: 'Start with the sidebar retracted' })).toBeChecked()
  })
})
