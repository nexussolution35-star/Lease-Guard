import { Inject, Injectable, Logger } from '@nestjs/common'

import type { ApiEnv } from '../../config/env'
import { API_ENV } from '../../config/tokens'
import { addressFromGoogle, type GoogleAddressComponent, type SuggestedAddress } from './google-address'

const TIMEOUT_MS = 5_000

/** One suggestion for the list: the place's name and, when known, where it is. */
export interface AddressSuggestion {
  placeId: string
  primary: string
  secondary?: string
}

/** Google did not answer usefully (network, timeout, quota, a refused key). Details are logged, never returned. */
export class GooglePlacesUnavailableError extends Error {}

interface AutocompleteResponse {
  suggestions?: {
    placePrediction?: {
      placeId?: string
      text?: { text?: string }
      structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } }
    }
  }[]
}

interface PlaceResponse {
  addressComponents?: GoogleAddressComponent[]
  formattedAddress?: string
}

/**
 * Google Places API (New), server to server. The key travels only in the X-Goog-Api-Key header from this process;
 * requests ask for the fields LeaseGuard uses and nothing more (Essentials SKU for place details).
 */
@Injectable()
export class GooglePlacesClient {
  private readonly logger = new Logger(GooglePlacesClient.name)

  constructor(@Inject(API_ENV) private readonly env: ApiEnv) {}

  get configured(): boolean {
    return Boolean(this.env.GOOGLE_MAPS_API_KEY)
  }

  /** Suggestions restricted to South Africa, in English. */
  async autocomplete(input: string, sessionToken: string): Promise<AddressSuggestion[]> {
    const body = await this.call<AutocompleteResponse>('Autocomplete', '/v1/places:autocomplete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-FieldMask': 'suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat',
      },
      body: JSON.stringify({ input, sessionToken, includedRegionCodes: ['za'], languageCode: 'en', regionCode: 'za' }),
    })
    const suggestions: AddressSuggestion[] = []
    for (const suggestion of body.suggestions ?? []) {
      const prediction = suggestion.placePrediction
      const primary = prediction?.structuredFormat?.mainText?.text ?? prediction?.text?.text
      if (!prediction?.placeId || !primary) continue
      const secondary = prediction.structuredFormat?.secondaryText?.text
      suggestions.push({ placeId: prediction.placeId, primary, ...(secondary ? { secondary } : {}) })
    }
    return suggestions
  }

  /** The address of a suggested place. Ends the Google session the token started. */
  async address(placeId: string, sessionToken: string): Promise<SuggestedAddress> {
    const query = new URLSearchParams({ sessionToken, languageCode: 'en', regionCode: 'za' })
    const body = await this.call<PlaceResponse>('Place details', `/v1/places/${encodeURIComponent(placeId)}?${query.toString()}`, {
      method: 'GET',
      headers: { 'X-Goog-FieldMask': 'addressComponents,formattedAddress' },
    })
    return addressFromGoogle(body.addressComponents ?? [], body.formattedAddress)
  }

  private async call<T>(operation: string, path: string, init: RequestInit): Promise<T> {
    const key = this.env.GOOGLE_MAPS_API_KEY
    if (!key) throw new GooglePlacesUnavailableError('Google Maps is not configured')
    let response: Response
    try {
      response = await fetch(new URL(path, this.env.GOOGLE_PLACES_API_URL), {
        ...init,
        headers: { ...(init.headers as Record<string, string>), 'X-Goog-Api-Key': key },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch (error) {
      this.logger.warn(`${operation} failed: ${error instanceof Error ? error.name : 'network error'}`)
      throw new GooglePlacesUnavailableError(`${operation} failed`)
    }
    if (!response.ok) {
      // Google's error status (e.g. PERMISSION_DENIED, RESOURCE_EXHAUSTED) helps an operator; the key is never in it.
      const detail = await response.text().catch(() => '')
      const status = /"status"\s*:\s*"([A-Z_]+)"/.exec(detail)?.[1] ?? 'unknown'
      this.logger.warn(`${operation} refused by Google: HTTP ${response.status} ${status}`)
      throw new GooglePlacesUnavailableError(`${operation} refused`)
    }
    return (await response.json()) as T
  }
}
