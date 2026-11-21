import { afterEach, describe, expect, it, vi } from 'vitest'

import { canRememberBrowserPreferences, readBrowserPreference, writeBrowserPreference } from './browserStorage'

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('browser preference storage', () => {
  it('reads, writes and removes', () => {
    expect(writeBrowserPreference('k', 'v')).toBe(true)
    expect(readBrowserPreference('k')).toBe('v')
    expect(writeBrowserPreference('k', null)).toBe(true)
    expect(readBrowserPreference('k')).toBeNull()
    expect(canRememberBrowserPreferences()).toBe(true)
  })

  it('never throws when storage is blocked', () => {
    const blocked = () => {
      throw new DOMException('Blocked', 'SecurityError')
    }
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked)
    expect(readBrowserPreference('k')).toBeNull()
    expect(writeBrowserPreference('k', 'v')).toBe(false)
    expect(canRememberBrowserPreferences()).toBe(false)
  })
})
