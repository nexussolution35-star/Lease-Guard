import { useCallback, useSyncExternalStore } from 'react'

function mediaQuery(query: string): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null
  return window.matchMedia(query)
}

/** Whether a media query matches now, updated when it changes (`false` where `matchMedia` is unavailable). */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (listener: () => void) => {
      const list = mediaQuery(query)
      list?.addEventListener('change', listener)
      return () => list?.removeEventListener('change', listener)
    },
    [query],
  )
  return useSyncExternalStore(subscribe, () => mediaQuery(query)?.matches ?? false, () => false)
}
