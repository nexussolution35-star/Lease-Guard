import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import { isSameSecret, isValidMetaSignature, payloadSha256 } from './webhook-signature'

const SECRET = 'test-app-secret'
const body = Buffer.from('{"object":"whatsapp_business_account","entry":[]}')
const sign = (raw: Buffer, secret = SECRET) => `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`

describe('isValidMetaSignature', () => {
  it('accepts the HMAC-SHA256 of the raw bytes keyed with the app secret', () => {
    expect(isValidMetaSignature(body, sign(body), SECRET)).toBe(true)
    expect(isValidMetaSignature(body, sign(body).toUpperCase().replace('SHA256=', 'sha256='), SECRET)).toBe(true)
  })

  it('rejects a tampered body, a wrong secret, and a missing or malformed header', () => {
    const tampered = Buffer.from(body.toString().replace('[]', '[{}]'))
    expect(isValidMetaSignature(tampered, sign(body), SECRET)).toBe(false)
    expect(isValidMetaSignature(body, sign(body, 'another-secret'), SECRET)).toBe(false)
    expect(isValidMetaSignature(body, undefined, SECRET)).toBe(false)
    expect(isValidMetaSignature(body, '', SECRET)).toBe(false)
    expect(isValidMetaSignature(body, sign(body).replace('sha256=', 'sha1='), SECRET)).toBe(false)
    expect(isValidMetaSignature(body, `${sign(body)}00`, SECRET)).toBe(false)
  })

  it('never accepts anything without an app secret', () => {
    expect(isValidMetaSignature(body, sign(body, ''), '')).toBe(false)
  })

  it('is computed over the exact bytes: re-serialised JSON does not match', () => {
    const spaced = Buffer.from(JSON.stringify(JSON.parse(body.toString()), null, 2))
    expect(isValidMetaSignature(spaced, sign(body), SECRET)).toBe(false)
  })
})

describe('isSameSecret', () => {
  it('compares verify tokens exactly', () => {
    expect(isSameSecret('token-1', 'token-1')).toBe(true)
    expect(isSameSecret('token-2', 'token-1')).toBe(false)
    expect(isSameSecret('', '')).toBe(false)
  })
})

describe('payloadSha256', () => {
  it('is the hex SHA-256 of the raw body', () => {
    expect(payloadSha256(Buffer.from('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})
