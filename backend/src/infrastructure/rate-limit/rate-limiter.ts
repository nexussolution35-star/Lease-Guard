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
   * Records one use for each rule and says whether every rule still allows it. Throws when the counters cannot be
   * reached; callers decide whether to fail closed.
   */
  abstract consume(subject: string, rules: readonly RateLimitRule[]): Promise<RateLimitDecision>
}

/**
 * Fixed-window decision from counts already incremented: the first rule over its limit refuses, with the seconds left
 * in its window. Pure, so it is tested without Redis.
 */
export function decide(rules: readonly RateLimitRule[], counts: readonly number[], nowMs: number): RateLimitDecision {
  for (const [index, rule] of rules.entries()) {
    const count = counts[index] ?? 0
    if (count > rule.limit) {
      const windowMs = rule.windowSeconds * 1000
      const retryAfterSeconds = Math.max(1, Math.ceil((windowMs - (nowMs % windowMs)) / 1000))
      return { allowed: false, retryAfterSeconds, rule: rule.name }
    }
  }
  return { allowed: true }
}

/** Counter key of one rule, subject and window. */
export function counterKey(prefix: string, rule: RateLimitRule, subject: string, nowMs: number): string {
  return `${prefix}:ratelimit:${rule.name}:${subject}:${Math.floor(nowMs / (rule.windowSeconds * 1000))}`
}
