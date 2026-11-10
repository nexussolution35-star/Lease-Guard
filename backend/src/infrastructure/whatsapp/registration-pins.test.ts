import { describe, expect, it } from 'vitest'

import { type PinRedis, REGISTRATION_PIN_TTL_SECONDS, registrationPinKey, RegistrationPins } from './registration-pins'

function memoryRedis() {
  const values = new Map<string, string>()
  const expiries: Record<string, number> = {}
  const redis: PinRedis = {
    async set(key, value, _mode, seconds) {
      values.set(key, value)
      expiries[key] = seconds
      return 'OK'
    },
    async getdel(key) {
      const value = values.get(key) ?? null
      values.delete(key)
      return value
    },
  }
  return { redis, values, expiries }
}

const COMPANY = '6F1D2C1E-0000-4000-8000-000000000001'
const NUMBER = '7a1d2c1e-0000-4000-8000-000000000009'

describe('RegistrationPins', () => {
  it('hands a PIN over once, through a short-lived key under the queue prefix', async () => {
    const { redis, values, expiries } = memoryRedis()
    const pins = new RegistrationPins(redis, 'lg')
    await pins.put(COMPANY, NUMBER, '123456')
    const key = registrationPinKey('lg', COMPANY, NUMBER)
    expect(key).toBe(`lg:whatsapp-registration-pin:${COMPANY.toLowerCase()}:${NUMBER}`)
    expect(expiries[key]).toBe(REGISTRATION_PIN_TTL_SECONDS)
    expect(values.size).toBe(1)

    await expect(pins.take(COMPANY.toLowerCase(), NUMBER)).resolves.toBe('123456')
    await expect(pins.take(COMPANY, NUMBER)).resolves.toBeNull()
    expect(values.size).toBe(0)
  })

  it('accepts only 6 digits', async () => {
    const { redis, values } = memoryRedis()
    const pins = new RegistrationPins(redis, 'lg')
    await expect(pins.put(COMPANY, NUMBER, '12345')).rejects.toThrow('6 digits')
    await expect(pins.put(COMPANY, NUMBER, '12345a')).rejects.toThrow('6 digits')
    values.set(registrationPinKey('lg', COMPANY, NUMBER), 'garbage')
    await expect(pins.take(COMPANY, NUMBER)).resolves.toBeNull()
  })
})
