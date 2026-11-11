/** A limit: at most `limit` uses per `windowSeconds`, counted per subject (e.g. a user id). */
export interface RateLimitRule {
  /** Stable name; part of the counter key, e.g. `address-search-minute`. */
  name: string
  limit: number
  windowSeconds: number
}

export type RateLimitDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number; rule: string }

/** Counts uses against rules. Implementations are shared across API replicas (Redis); tests use a fake. */
export abstract class RateLimiter {
  /**
   * Allows the use only when every rule still has room, and then counts it against every rule; a refused use counts
   * against none (so refusals cannot use up anyone's allowance). Throws when the counters cannot be reached; callers
   * decide whether to fail closed.
   */
  abstract consume(subject: string, rules: readonly RateLimitRule[]): Promise<RateLimitDecision>
}

/** Seconds until the current fixed window of `rule` ends (at least one). */
export function retryAfterSeconds(rule: RateLimitRule, nowMs: number): number {
  const windowMs = rule.windowSeconds * 1000
  return Math.max(1, Math.ceil((windowMs - (nowMs % windowMs)) / 1000))
}

/**
 * Fixed-window decision from the counts BEFORE this use: the first rule already at its limit refuses, with the
 * seconds left in its window. Pure, so it is tested without Redis.
 */
export function decide(rules: readonly RateLimitRule[], countsBefore: readonly number[], nowMs: number): RateLimitDecision {
  for (const [index, rule] of rules.entries()) {
    if ((countsBefore[index] ?? 0) >= rule.limit) return { allowed: false, retryAfterSeconds: retryAfterSeconds(rule, nowMs), rule: rule.name }
  }
  return { allowed: true }
}

/** Counter key of one rule, subject and window. */
export function counterKey(prefix: string, rule: RateLimitRule, subject: string, nowMs: number): string {
  return `${prefix}:ratelimit:${rule.name}:${subject}:${Math.floor(nowMs / (rule.windowSeconds * 1000))}`
}
