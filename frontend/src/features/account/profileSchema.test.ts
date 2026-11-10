import { describe, expect, it } from 'vitest'

import { profileChangesFrom, profileFormDefaults, profileFormSchema, WHATSAPP_NUMBER_ERROR } from './profileSchema'

const valid = { fullName: '  Ayanda Nkosi ', phone: ' 011 555 0100 ', whatsappNumber: '', jobTitle: 'Portfolio manager' }

describe('profileFormSchema', () => {
  it('trims values and requires a full name', () => {
    expect(profileFormSchema.parse(valid)).toEqual({ ...valid, fullName: 'Ayanda Nkosi', phone: '011 555 0100' })
    expect(profileFormSchema.safeParse({ ...valid, fullName: '   ' }).success).toBe(false)
  })

  it('stores WhatsApp numbers as E.164, accepting South African local formats', () => {
    expect(profileFormSchema.parse({ ...valid, whatsappNumber: '082 123 4567' }).whatsappNumber).toBe('+27821234567')
    expect(profileFormSchema.parse({ ...valid, whatsappNumber: '+27 82 123 4567' }).whatsappNumber).toBe('+27821234567')
    expect(profileFormSchema.parse({ ...valid, whatsappNumber: '+44 20 7946 0958' }).whatsappNumber).toBe('+442079460958')
  })

  it('rejects numbers that are not E.164', () => {
    const result = profileFormSchema.safeParse({ ...valid, whatsappNumber: '12345' })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toBe(WHATSAPP_NUMBER_ERROR)
  })

  it('limits field lengths like the API', () => {
    expect(profileFormSchema.safeParse({ ...valid, jobTitle: 'x'.repeat(101) }).success).toBe(false)
    expect(profileFormSchema.safeParse({ ...valid, phone: '1'.repeat(31) }).success).toBe(false)
  })
})

describe('profile form mapping', () => {
  it('fills unset optional fields with empty strings', () => {
    expect(profileFormDefaults({ fullName: 'Ayanda Nkosi' })).toEqual({ fullName: 'Ayanda Nkosi', phone: '', whatsappNumber: '', jobTitle: '' })
  })

  it('sends emptied optional fields as null so the API clears them', () => {
    expect(profileChangesFrom({ fullName: 'Ayanda Nkosi', phone: '', whatsappNumber: '+27821234567', jobTitle: '' })).toEqual({
      fullName: 'Ayanda Nkosi',
      phone: null,
      whatsappNumber: '+27821234567',
      jobTitle: null,
    })
  })
})
