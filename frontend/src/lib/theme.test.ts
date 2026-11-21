import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const KEY = 'leaseguard.theme'

async function freshModule() {
  vi.resetModules()
  return import('./theme')
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  document.head.innerHTML = '<meta name="color-scheme" content="light dark">'
})
afterEach(() => vi.restoreAllMocks())

describe('theme preference', () => {
  it('reads the stored choice on load and defaults to system', async () => {
    expect((await freshModule()).getThemePreference()).toBe('system')
    localStorage.setItem(KEY, 'dark')
    expect((await freshModule()).getThemePreference()).toBe('dark')
    localStorage.setItem(KEY, 'sepia')
    expect((await freshModule()).getThemePreference()).toBe('system')
  })

  it('applies a choice to data-theme and color-scheme; system restores both', async () => {
    const { setThemePreference } = await freshModule()
    setThemePreference('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]')?.content).toBe('dark')
    expect(localStorage.getItem(KEY)).toBe('dark')

    setThemePreference('system')
    expect(document.documentElement).not.toHaveAttribute('data-theme')
    expect(document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]')?.content).toBe('light dark')
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('still applies when storage throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError')
    })
    const { getThemePreference, setThemePreference } = await freshModule()
    expect(getThemePreference()).toBe('system')
    setThemePreference('light')
    expect(getThemePreference()).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('follows a choice made in another tab', async () => {
    const { useThemePreference } = await freshModule()
    const { result } = renderHook(() => useThemePreference())
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue: 'dark' }))
    })
    expect(result.current).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })
})
