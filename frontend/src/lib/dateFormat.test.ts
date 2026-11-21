import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const KEY = 'leaseguard.dateFormat'

async function freshModule() {
  vi.resetModules()
  return import('./dateFormat')
}

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('date format preference', () => {
  // One fresh module per test: each re-import loads the domain package again, which is slow under full-suite load.
  it('defaults to the South African format when nothing is stored', async () => {
    expect((await freshModule()).getDateFormatPreference()).toBe('dd-mmm-yyyy')
  })

  it('reads the stored choice on load', async () => {
    localStorage.setItem(KEY, 'yyyy-mm-dd')
    expect((await freshModule()).getDateFormatPreference()).toBe('yyyy-mm-dd')
  })

  it('reads an unrecognised stored value as the default', async () => {
    localStorage.setItem(KEY, 'dd.mm.yy')
    expect((await freshModule()).getDateFormatPreference()).toBe('dd-mmm-yyyy')
  })

  it('remembers a choice and removes the stored value for the default', async () => {
    const { setDateFormatPreference } = await freshModule()
    setDateFormatPreference('mmm-d-yyyy')
    expect(localStorage.getItem(KEY)).toBe('mmm-d-yyyy')
    setDateFormatPreference('dd-mmm-yyyy')
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('re-renders the shared formatter when the choice changes', async () => {
    const { setDateFormatPreference, useDateFormatter } = await freshModule()
    const { result } = renderHook(() => useDateFormatter())
    expect(result.current.date('2026-11-21')).toBe('21 Nov 2026')
    expect(result.current.dateTime('2026-11-21T08:30:00+02:00')).toBe('21 Nov 2026, 08:30')
    act(() => setDateFormatPreference('dd/mm/yyyy'))
    expect(result.current.format).toBe('dd/mm/yyyy')
    expect(result.current.date('2026-11-21')).toBe('21/11/2026')
    expect(result.current.dateTime('2026-11-21T08:30:00+02:00')).toBe('21/11/2026, 08:30')
  })

  it('follows a choice made in another tab', async () => {
    const { useDateFormatPreference } = await freshModule()
    const { result } = renderHook(() => useDateFormatPreference())
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue: 'yyyy/mm/dd' }))
    })
    expect(result.current).toBe('yyyy/mm/dd')
  })

  it('still applies for the session when storage throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError')
    })
    const { getDateFormatPreference, setDateFormatPreference } = await freshModule()
    expect(getDateFormatPreference()).toBe('dd-mmm-yyyy')
    setDateFormatPreference('d-mmmm-yyyy')
    expect(getDateFormatPreference()).toBe('d-mmmm-yyyy')
  })
})
