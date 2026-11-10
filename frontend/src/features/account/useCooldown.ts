import { useCallback, useEffect, useState } from 'react'

/** Whole seconds left until `until` (epoch milliseconds), never negative; 0 without a cooldown. */
export function secondsUntil(until: number | null, now: number): number {
  if (until === null) return 0
  return Math.max(0, Math.ceil((until - now) / 1000))
}

export interface Cooldown {
  /** 0 when the action may run again. */
  secondsLeft: number
  /** Starts (or restarts) a cooldown of `seconds`. */
  start(seconds: number): void
}

/** A countdown that ticks once a second while it runs, e.g. before an email may be requested again. */
export function useCooldown(): Cooldown {
  const [until, setUntil] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (until === null) return
    const timer = setInterval(() => {
      const current = Date.now()
      setNow(current)
      if (current >= until) setUntil(null)
    }, 1000)
    return () => clearInterval(timer)
  }, [until])

  const start = useCallback((seconds: number) => {
    const current = Date.now()
    setNow(current)
    setUntil(current + seconds * 1000)
  }, [])

  return { secondsLeft: secondsUntil(until, now), start }
}
