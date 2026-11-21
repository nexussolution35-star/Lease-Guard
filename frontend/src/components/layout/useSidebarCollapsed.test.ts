import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const KEY = 'leaseguard.sidebarCollapsed'

async function freshModule() {
  vi.resetModules()
  return import('./useSidebarCollapsed')
}

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('useSidebarCollapsed', () => {
  it('starts as remembered on the next load', async () => {
    localStorage.setItem(KEY, 'true')
    const { getSidebarCollapsed } = await freshModule()
    expect(getSidebarCollapsed()).toBe(true)
  })

  it('starts expanded with nothing stored, or when storage cannot be read', async () => {
    expect((await freshModule()).getSidebarCollapsed()).toBe(false)
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError')
    })
    expect((await freshModule()).getSidebarCollapsed()).toBe(false)
  })

  it('toggles and persists the state', async () => {
    const { useSidebarCollapsed } = await freshModule()
    const { result } = renderHook(() => useSidebarCollapsed())
    act(() => result.current[1]())
    expect(result.current[0]).toBe(true)
    expect(localStorage.getItem(KEY)).toBe('true')
  })

  it('follows a change made in another tab', async () => {
    const { useSidebarCollapsed } = await freshModule()
    const { result } = renderHook(() => useSidebarCollapsed())
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue: 'true' }))
    })
    expect(result.current[0]).toBe(true)
  })
})
