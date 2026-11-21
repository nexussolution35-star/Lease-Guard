import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const KEY = 'leaseguard.motion'

async function freshModule() {
  vi.resetModules()
  return import('./motion')
}

/** The device's reduced-motion setting as `matchMedia` reports it. */
function deviceReducesMotion(reduce: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: reduce && query === '(prefers-reduced-motion: reduce)',
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList,
  )
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-motion')
})
afterEach(() => vi.restoreAllMocks())

describe('motion preference', () => {
  it('reads the stored choice on load, defaults to system and applies it at startup', async () => {
    expect((await freshModule()).getMotionPreference()).toBe('system')
    localStorage.setItem(KEY, 'warp')
    expect((await freshModule()).getMotionPreference()).toBe('system')
    localStorage.setItem(KEY, 'reduce')
    const { getMotionPreference, initMotion } = await freshModule()
    expect(getMotionPreference()).toBe('reduce')
    initMotion()
    expect(document.documentElement).toHaveAttribute('data-motion', 'reduce')
  })

  it('sets data-motion for reduce and full, and system removes it and the stored choice', async () => {
    const { setMotionPreference } = await freshModule()
    setMotionPreference('reduce')
    expect(document.documentElement).toHaveAttribute('data-motion', 'reduce')
    expect(localStorage.getItem(KEY)).toBe('reduce')
    setMotionPreference('full')
    expect(document.documentElement).toHaveAttribute('data-motion', 'full')
    expect(localStorage.getItem(KEY)).toBe('full')
    setMotionPreference('system')
    expect(document.documentElement).not.toHaveAttribute('data-motion')
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('reduces motion from script by the choice first, then the device', async () => {
    deviceReducesMotion(true)
    const { isMotionReduced, setMotionPreference } = await freshModule()
    expect(isMotionReduced()).toBe(true)
    setMotionPreference('full')
    expect(isMotionReduced()).toBe(false)
    deviceReducesMotion(false)
    setMotionPreference('system')
    expect(isMotionReduced()).toBe(false)
    setMotionPreference('reduce')
    expect(isMotionReduced()).toBe(true)
  })

  it('follows a choice made in another tab', async () => {
    const { useMotionPreference } = await freshModule()
    const { result } = renderHook(() => useMotionPreference())
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue: 'full' }))
    })
    expect(result.current).toBe('full')
    expect(document.documentElement).toHaveAttribute('data-motion', 'full')
  })

  it('still applies for the session when storage throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError')
    })
    const { getMotionPreference, setMotionPreference } = await freshModule()
    expect(getMotionPreference()).toBe('system')
    setMotionPreference('reduce')
    expect(getMotionPreference()).toBe('reduce')
    expect(document.documentElement).toHaveAttribute('data-motion', 'reduce')
  })
})
