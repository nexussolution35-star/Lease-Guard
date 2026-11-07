import { useCallback, useState } from 'react'

export const SIDEBAR_COLLAPSED_STORAGE_KEY = 'leaseguard.sidebarCollapsed'

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

/** Desktop sidebar collapsed (icon rail) state, persisted per browser. */
export function useSidebarCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState<boolean>(readCollapsed)
  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(next))
      } catch {
        // Ignore unavailable storage; the state still applies for this session.
      }
      return next
    })
  }, [])
  return [collapsed, toggle]
}
