import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'

import { TooManyRequestsException } from '../../common/http/too-many-requests.exception'
import type { ApiEnv } from '../../config/env'
import { API_ENV } from '../../config/tokens'
import { RateLimiter, type RateLimitRule } from '../../infrastructure/rate-limit/rate-limiter'
import type { AddressResolveBody, AddressSearchBody } from './address-suggestions.schemas'
import type { SuggestedAddress } from './google-address'
import { GooglePlacesClient, GooglePlacesUnavailableError, type AddressSuggestion } from './google-places.client'

const MINUTE = 60
const DAY = 86_400

/**
 * Per-user limits. Typing pauses 250 ms before a search, so one address costs a handful of searches and one place
 * lookup; these leave room for a busy day of data entry and stop a runaway client or script.
 */
export const SEARCH_RULES: readonly RateLimitRule[] = [
  { name: 'address-search-minute', limit: 30, windowSeconds: MINUTE },
  { name: 'address-search-day', limit: 600, windowSeconds: DAY },
]
export const RESOLVE_RULES: readonly RateLimitRule[] = [
  { name: 'address-resolve-minute', limit: 10, windowSeconds: MINUTE },
  { name: 'address-resolve-day', limit: 150, windowSeconds: DAY },
]
/** Everyone together: the deployment's daily cost ceiling (ADDRESS_LOOKUP_DAILY_LIMIT). */
const ALL_USERS = 'all-users'

export const NOT_CONFIGURED_MESSAGE = 'Address suggestions are not set up. Type the address in full.'
export const UNAVAILABLE_MESSAGE = 'Address suggestions are unavailable right now. Type the address in full.'

/**
 * Address suggestions for signed-in users, through LeaseGuard's server so the Google key never reaches a browser.
 * Every call is counted first (per user per minute and per day, and for the whole deployment per day); a refusal is a
 * 429 with Retry-After. When the counters cannot be reached the call is refused (503), never sent to Google uncounted.
 */
@Injectable()
export class AddressSuggestionsService {
  private readonly logger = new Logger(AddressSuggestionsService.name)

  constructor(
    private readonly places: GooglePlacesClient,
    private readonly limiter: RateLimiter,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  status(): { available: boolean } {
    return { available: this.places.configured }
  }

  async search(userId: string, body: AddressSearchBody): Promise<AddressSuggestion[]> {
    this.assertConfigured()
    await this.count(userId, SEARCH_RULES)
    return this.google(() => this.places.autocomplete(body.input, body.sessionToken))
  }

  async resolve(userId: string, body: AddressResolveBody): Promise<SuggestedAddress> {
    this.assertConfigured()
    await this.count(userId, RESOLVE_RULES)
    return this.google(() => this.places.address(body.placeId, body.sessionToken))
  }

  private assertConfigured(): void {
    if (!this.places.configured) throw new ServiceUnavailableException(NOT_CONFIGURED_MESSAGE)
  }

  private async count(userId: string, rules: readonly RateLimitRule[]): Promise<void> {
    const deployment: RateLimitRule = { name: 'address-lookup-deployment-day', limit: this.env.ADDRESS_LOOKUP_DAILY_LIMIT, windowSeconds: DAY }
    let mine, everyone
    try {
      ;[mine, everyone] = await Promise.all([this.limiter.consume(userId, rules), this.limiter.consume(ALL_USERS, [deployment])])
    } catch (error) {
      this.logger.warn(`Address lookup refused: the rate-limit counters are unreachable (${error instanceof Error ? error.message : 'unknown'})`)
      throw new ServiceUnavailableException(UNAVAILABLE_MESSAGE)
    }
    if (!mine.allowed) {
      throw new TooManyRequestsException('Too many address lookups. Wait a moment, or type the address in full.', mine.retryAfterSeconds)
    }
    if (!everyone.allowed) {
      this.logger.warn('Address lookups reached the daily limit for this deployment (ADDRESS_LOOKUP_DAILY_LIMIT)')
      throw new TooManyRequestsException('Address suggestions have reached today\'s limit. Type the address in full.', everyone.retryAfterSeconds)
    }
  }

  private async google<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call()
    } catch (error) {
      if (error instanceof GooglePlacesUnavailableError) throw new ServiceUnavailableException(UNAVAILABLE_MESSAGE)
      throw error
    }
  }
}
