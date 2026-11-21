import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setSidebarCollapsed, SIDEBAR_COLLAPSED_STORAGE_KEY, useSidebarCollapsed } from '@/components/layout/useSidebarCollapsed'
import { ThemeSubMenu } from '@/components/layout/ThemeSubMenu'
import { DateDisplay } from '@/components/shared'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { DATE_FORMAT_STORAGE_KEY, setDateFormatPreference } from '@/lib/dateFormat'
import { MOTION_STORAGE_KEY, setMotionPreference } from '@/lib/motion'
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
  setDateFormatPreference('dd-mmm-yyyy')
  setMotionPreference('system')
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('PreferencesScreen', () => {
  it('says the preferences are kept in this browser only, with the defaults chosen', () => {
    render(<PreferencesScreen />)
    expect(screen.getByText(/saved in this browser only/i)).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(within(screen.getByRole('radiogroup', { name: 'Date format' })).getAllByRole('radio')[0]).toBeChecked()
    expect(within(screen.getByRole('radiogroup', { name: 'Motion' })).getByRole('radio', { name: /System/ })).toBeChecked()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('offers six date formats, each with today as its example, and changes every displayed date at once', async () => {
    vi.useFakeTimers({ now: new Date(2026, 10, 21, 9, 0), toFake: ['Date'] })
    render(
      <>
        <PreferencesScreen />
        <p data-testid="elsewhere">
          <DateDisplay value="2026-03-05" />
        </p>
      </>,
    )
    vi.useRealTimers()
    const group = screen.getByRole('radiogroup', { name: 'Date format' })
    const labels = within(group)
      .getAllByRole('radio')
      .map((radio) => radio.closest('label')?.querySelector('span > span')?.textContent)
    expect(labels).toEqual(['21 Nov 2026', '21 November 2026', '21/11/2026', '2026/11/21', 'Nov 21, 2026', '2026-11-21'])
    expect(screen.getByTestId('elsewhere')).toHaveTextContent('05 Mar 2026')

    await userEvent.click(within(group).getByRole('radio', { name: /Nov 21, 2026/ }))
    expect(screen.getByTestId('elsewhere')).toHaveTextContent('Mar 5, 2026')
    expect(localStorage.getItem(DATE_FORMAT_STORAGE_KEY)).toBe('mmm-d-yyyy')

    await userEvent.click(within(group).getByRole('radio', { name: /^21 Nov 2026/ }))
    expect(screen.getByTestId('elsewhere')).toHaveTextContent('05 Mar 2026')
    expect(localStorage.getItem(DATE_FORMAT_STORAGE_KEY)).toBeNull()
  })

  it('reduces or keeps motion on <html data-motion>, remembers it, and System removes it', async () => {
    render(<PreferencesScreen />)
    const group = screen.getByRole('radiogroup', { name: 'Motion' })
    expect(within(group).getByRole('radio', { name: /System/ })).toHaveAccessibleDescription(/currently full motion/)

    await userEvent.click(within(group).getByRole('radio', { name: /Reduce motion/ }))
    expect(document.documentElement).toHaveAttribute('data-motion', 'reduce')
    expect(localStorage.getItem(MOTION_STORAGE_KEY)).toBe('reduce')

    await userEvent.click(within(group).getByRole('radio', { name: /Full motion/ }))
    expect(document.documentElement).toHaveAttribute('data-motion', 'full')
    expect(localStorage.getItem(MOTION_STORAGE_KEY)).toBe('full')

    await userEvent.click(within(group).getByRole('radio', { name: /System/ }))
    expect(document.documentElement).not.toHaveAttribute('data-motion')
    expect(localStorage.getItem(MOTION_STORAGE_KEY)).toBeNull()
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

    await userEvent.click(screen.getByRole('radio', { name: /^\d{4}-\d{2}-\d{2}/ }))
    expect(screen.getByRole('radio', { name: /^\d{4}-\d{2}-\d{2}/ })).toBeChecked()

    await userEvent.click(screen.getByRole('radio', { name: /Reduce motion/ }))
    expect(document.documentElement).toHaveAttribute('data-motion', 'reduce')
  })
})
