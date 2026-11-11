import { importLibrary, setOptions } from '@googlemaps/js-api-loader'

import { getAppConfig } from '@/services/api/config'

import { addressFromGoogle, type SuggestedAddress } from './addressFromGoogle'

/** One suggestion in the list: the place's name and, when known, where it is. */
export interface AddressSuggestion {
  id: string
  primary: string
  secondary?: string
}

/** Address suggestions as a user types. Implemented with Google Places; tests pass a fake. */
export interface AddressSuggestionSource {
  /** Starts loading what suggestions need (e.g. when the field is focused), so the first ones arrive sooner. Not billed. */
  prepare?(): void
  /** Suggestions for the typed text (South Africa only). */
  suggest(input: string): Promise<AddressSuggestion[]>
  /** The address fields of a suggestion from the latest `suggest` call; ends the lookup session. */
  resolve(suggestion: AddressSuggestion): Promise<SuggestedAddress>
}

let placesLibrary: Promise<google.maps.PlacesLibrary> | undefined

function loadPlaces(apiKey: string): Promise<google.maps.PlacesLibrary> {
  if (!placesLibrary) {
    setOptions({ key: apiKey, v: 'weekly', language: 'en', region: 'ZA' })
    placesLibrary = importLibrary('places').catch((error: unknown) => {
      // Let a later attempt try again (e.g. the network was down).
      placesLibrary = undefined
      throw error
    })
  }
  return placesLibrary
}

/**
 * Google Places API (New) suggestions restricted to South Africa. One session token covers the typing and the
 * lookup of the chosen place (Google bills it as one session); a new one starts with the next lookup.
 */
export function createGoogleAddressSource(apiKey: string): AddressSuggestionSource {
  let sessionToken: google.maps.places.AutocompleteSessionToken | undefined
  let predictions = new Map<string, google.maps.places.PlacePrediction>()

  return {
    prepare() {
      // Loading the script is free; only suggestion and place requests are billed. A failure shows on the next suggest.
      loadPlaces(apiKey).catch(() => undefined)
    },

    async suggest(input) {
      const { AutocompleteSessionToken, AutocompleteSuggestion } = await loadPlaces(apiKey)
      sessionToken ??= new AutocompleteSessionToken()
      const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
        input,
        sessionToken,
        includedRegionCodes: ['za'],
        language: 'en',
        region: 'za',
      })
      predictions = new Map()
      const items: AddressSuggestion[] = []
      for (const suggestion of suggestions) {
        const prediction = suggestion.placePrediction
        if (!prediction) continue
        predictions.set(prediction.placeId, prediction)
        const secondary = prediction.secondaryText?.toString()
        items.push({ id: prediction.placeId, primary: (prediction.mainText ?? prediction.text).toString(), ...(secondary ? { secondary } : {}) })
      }
      return items
    },

    async resolve(suggestion) {
      const prediction = predictions.get(suggestion.id)
      if (!prediction) throw new Error('That suggestion is no longer available. Type the address again.')
      const place = prediction.toPlace()
      try {
        await place.fetchFields({ fields: ['addressComponents', 'formattedAddress', 'displayName'] })
      } finally {
        // fetchFields ends the session; the next lookup starts a new one.
        sessionToken = undefined
        predictions = new Map()
      }
      return addressFromGoogle(place.addressComponents ?? [], { displayName: place.displayName, formattedAddress: place.formattedAddress })
    },
  }
}

let source: AddressSuggestionSource | null | undefined

/** The address suggestion source of this build, or null when no Google Maps key is configured. */
export function getAddressSuggestionSource(): AddressSuggestionSource | null {
  if (source === undefined) {
    const apiKey = getAppConfig().googleMapsApiKey
    source = apiKey ? createGoogleAddressSource(apiKey) : null
  }
  return source
}
