import { SA_PROVINCES, type SAProvince } from '@leaseguard/domain'

/** One address component as the Places API (New) returns it on `Place.addressComponents`. */
export interface GoogleAddressComponent {
  longText: string | null
  shortText: string | null
  types: readonly string[]
}

/**
 * The parts of a South African address LeaseGuard fills from a chosen suggestion. Parts Google does not know are left
 * out, so the form keeps what the user typed for them.
 */
export interface SuggestedAddress {
  line1: string
  suburb?: string
  city?: string
  province?: SAProvince
  postalCode?: string
}

const letters = (value: string) => value.toLowerCase().replace(/[^a-z]/g, '')

/** Province by Google's long name ("KwaZulu-Natal") or its short code ("KZN"). */
const PROVINCE_BY_NAME: ReadonlyMap<string, SAProvince> = new Map<string, SAProvince>([
  ...SA_PROVINCES.map((province): [string, SAProvince] => [letters(province), province]),
  ['ec', 'Eastern Cape'],
  ['fs', 'Free State'],
  ['gp', 'Gauteng'],
  ['gt', 'Gauteng'],
  ['kzn', 'KwaZulu-Natal'],
  ['nl', 'KwaZulu-Natal'],
  ['lp', 'Limpopo'],
  ['mp', 'Mpumalanga'],
  ['nw', 'North West'],
  ['nc', 'Northern Cape'],
  ['wc', 'Western Cape'],
])

export function provinceFromGoogle(...names: (string | null | undefined)[]): SAProvince | undefined {
  for (const name of names) {
    const province = name ? PROVINCE_BY_NAME.get(letters(name)) : undefined
    if (province) return province
  }
  return undefined
}

/**
 * Maps a place's address components to LeaseGuard's address fields: street number and route as the first line
 * (falling back to the place's name or the first part of the formatted address, e.g. for a shopping centre), the
 * suburb (sublocality or neighbourhood), the city (locality, else the district), the province and a four-digit
 * postal code.
 */
export function addressFromGoogle(
  components: readonly GoogleAddressComponent[],
  fallback: { displayName?: string | null; formattedAddress?: string | null } = {},
): SuggestedAddress {
  const find = (...types: string[]) => {
    for (const type of types) {
      const component = components.find((c) => c.types.includes(type))
      if (component) return component
    }
    return undefined
  }
  const text = (component: GoogleAddressComponent | undefined) => component?.longText?.trim() || component?.shortText?.trim() || undefined

  const street = [text(find('street_number')), text(find('route'))].filter(Boolean).join(' ')
  const line1 = street || fallback.displayName?.trim() || fallback.formattedAddress?.split(',')[0]?.trim() || ''
  const suburb = text(find('sublocality_level_1', 'sublocality', 'neighborhood'))
  const city = text(find('locality', 'postal_town', 'administrative_area_level_2'))
  const region = find('administrative_area_level_1')
  const province = provinceFromGoogle(region?.longText, region?.shortText)
  const postal = text(find('postal_code'))
  const postalCode = postal && /^[0-9]{4}$/.test(postal) ? postal : undefined

  return {
    line1,
    ...(suburb && suburb !== city ? { suburb } : {}),
    ...(city ? { city } : {}),
    ...(province ? { province } : {}),
    ...(postalCode ? { postalCode } : {}),
  }
}
