import { describe, expect, it } from 'vitest'

import { REDACTED, redactQuery, redactUrl } from './redact-url'

describe('redactUrl', () => {
  it("replaces Meta's verify token and keeps the rest of the url", () => {
    expect(redactUrl('/api/v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=s3cret&hub.challenge=1158201444')).toBe(
      `/api/v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${REDACTED}&hub.challenge=1158201444`,
    )
  })

  it('redacts an encoded or repeated parameter name and a parameter without a value', () => {
    const redacted = redactUrl('/w?hub%2Everify_token=a&hub.verify_token=b&hub.verify_token#frag')
    expect(redacted).not.toMatch(/=a|=b/)
    expect(redacted).toBe(`/w?hub%2Everify_token=${REDACTED}&hub.verify_token=${REDACTED}&hub.verify_token=${REDACTED}#frag`)
  })

  it('leaves urls without secrets unchanged', () => {
    expect(redactUrl('/api/v1/leases?page=2&pageSize=20')).toBe('/api/v1/leases?page=2&pageSize=20')
    expect(redactUrl('/health')).toBe('/health')
    expect(redactUrl(undefined)).toBeUndefined()
  })
})

describe('redactQuery', () => {
  it('returns a redacted copy and never changes the original', () => {
    const query = { 'hub.mode': 'subscribe', 'hub.verify_token': 's3cret' }
    expect(redactQuery(query)).toEqual({ 'hub.mode': 'subscribe', 'hub.verify_token': REDACTED })
    expect(query['hub.verify_token']).toBe('s3cret')
    expect(redactQuery({ page: '1' })).toEqual({ page: '1' })
  })
})
