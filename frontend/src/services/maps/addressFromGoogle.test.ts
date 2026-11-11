import { describe, expect, it } from 'vitest'

import { addressFromGoogle, provinceFromGoogle, type GoogleAddressComponent } from './addressFromGoogle'

const component = (longText: string, types: string[], shortText = longText): GoogleAddressComponent => ({ longText, shortText, types })

const SANDTON: GoogleAddressComponent[] = [
  component('12', ['street_number']),
  component('Fredman Drive', ['route'], 'Fredman Dr'),
  component('Sandown', ['sublocality_level_1', 'sublocality', 'political']),
  component('Sandton', ['locality', 'political']),
  component('City of Johannesburg Metropolitan Municipality', ['administrative_area_level_2', 'political']),
  component('Gauteng', ['administrative_area_level_1', 'political'], 'GP'),
  component('South Africa', ['country', 'political'], 'ZA'),
  component('2196', ['postal_code']),
]

describe('addressFromGoogle', () => {
  it('maps a street address to the address fields', () => {
    expect(addressFromGoogle(SANDTON)).toEqual({ line1: '12 Fredman Drive', suburb: 'Sandown', city: 'Sandton', province: 'Gauteng', postalCode: '2196' })
  })

  it('uses the place name when the place has no street, e.g. a shopping centre', () => {
    const mall = SANDTON.filter((c) => !c.types.includes('street_number') && !c.types.includes('route'))
    expect(addressFromGoogle(mall, { displayName: 'Sandton City', formattedAddress: 'Sandton City, Sandown, Sandton, 2196' }).line1).toBe('Sandton City')
    expect(addressFromGoogle(mall, { formattedAddress: '83 Rivonia Rd, Sandhurst, Sandton, 2196' }).line1).toBe('83 Rivonia Rd')
  })

  it('falls back to the district for the city and leaves out what Google does not know', () => {
    const rural = [component('Gauteng', ['administrative_area_level_1'], 'GP'), component('Sedibeng District Municipality', ['administrative_area_level_2'])]
    expect(addressFromGoogle(rural, { displayName: 'Farm 12' })).toEqual({ line1: 'Farm 12', city: 'Sedibeng District Municipality', province: 'Gauteng' })
  })

  it('drops a postal code that is not four digits and a suburb equal to the city', () => {
    const odd = [component('Cape Town', ['locality']), component('Cape Town', ['sublocality']), component('80001', ['postal_code'])]
    expect(addressFromGoogle(odd)).toEqual({ line1: '', city: 'Cape Town' })
  })
})

describe('provinceFromGoogle', () => {
  it.each([
    ['KwaZulu-Natal', 'KwaZulu-Natal'],
    ['Kwazulu Natal', 'KwaZulu-Natal'],
    ['KZN', 'KwaZulu-Natal'],
    ['WC', 'Western Cape'],
    ['North West', 'North West'],
    ['NC', 'Northern Cape'],
  ])('%s → %s', (name, province) => {
    expect(provinceFromGoogle(name)).toBe(province)
  })

  it('is undefined for a name outside South Africa', () => {
    expect(provinceFromGoogle('California', 'CA')).toBeUndefined()
  })
})
