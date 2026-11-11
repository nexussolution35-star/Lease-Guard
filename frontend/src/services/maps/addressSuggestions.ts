import { isApiError, unwrap, type ApiClient, type SuggestedAddressDto } from '@leaseguard/api-client'

import { describeApiError } from '@/lib/data/apiErrors'
import { getApiClient } from '@/services/api/client'

/** The address of a chosen suggestion; parts Google does not know are absent. */
export type SuggestedAddress = SuggestedAddressDto

/** One suggestion in the list: the place's name and, when known, where it is. */
export interface AddressSuggestion {
  id: string
  primary: string
  secondary?: string
}

/** Address suggestions as a user types. Through LeaseGuard's API; tests pass a fake. */
export interface AddressSuggestionSource {
  /** Whether this deployment offers suggestions (the API has a Google Maps key). False on any error. */
  available(): Promise<boolean>
  /** Suggestions for the typed text (South Africa only). Rejects with AddressLookupError. */
  suggest(input: string): Promise<AddressSuggestion[]>
  /** The address of a suggestion; ends the lookup session. Rejects with AddressLookupError. */
  resolve(suggestion: AddressSuggestion): Promise<SuggestedAddress>
}

/** A refused or failed lookup, with words for the user (e.g. the rate limit's "wait a moment"). */
export class AddressLookupError extends Error {}

const FALLBACK = 'Address suggestions are unavailable right now. Type the address in full.'

function lookupError(error: unknown): AddressLookupError {
  if (isApiError(error) && (error.status === 429 || error.status === 503)) {
    return new AddressLookupError(error.messages.join(' ') || FALLBACK)
  }
  return new AddressLookupError(describeApiError(error, FALLBACK))
}

/**
 * Suggestions from LeaseGuard's API, which calls Google Places with a key only the server holds. One session token
 * (a UUID) covers the searches and the resolve of one lookup, so Google bills them as one session.
 */
export function createApiAddressSource(api: ApiClient): AddressSuggestionSource {
  let availability: Promise<boolean> | undefined
  let sessionToken: string | undefined

  return {
    available() {
      // Any failure, even a synchronous one, means "no suggestions": the field stays a plain input.
      availability ??= Promise.resolve()
        .then(() => unwrap(api.GET('/api/v1/address-suggestions/status')))
        .then(
        (status) => status.available,
        () => {
          // Try again next time (e.g. the API was briefly unreachable).
          availability = undefined
          return false
        },
      )
      return availability
    },

    async suggest(input) {
      sessionToken ??= crypto.randomUUID()
      try {
        const { suggestions } = await unwrap(api.POST('/api/v1/address-suggestions', { body: { input, sessionToken } }))
        return suggestions.map((s) => ({ id: s.placeId, primary: s.primary, ...(s.secondary ? { secondary: s.secondary } : {}) }))
      } catch (error) {
        throw lookupError(error)
      }
    },

    async resolve(suggestion) {
      const token = sessionToken ?? crypto.randomUUID()
      // The resolve ends the session either way; the next lookup starts a new one.
      sessionToken = undefined
      try {
        return await unwrap(api.POST('/api/v1/address-suggestions/resolve', { body: { placeId: suggestion.id, sessionToken: token } }))
      } catch (error) {
        throw lookupError(error)
      }
    },
  }
}

let source: AddressSuggestionSource | undefined

/** The address suggestion source of this app (LeaseGuard's API), created on first use. */
export function getAddressSuggestionSource(): AddressSuggestionSource {
  source ??= createApiAddressSource(getApiClient())
  return source
}
