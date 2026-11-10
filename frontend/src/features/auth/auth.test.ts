import { describe, expect, it } from 'vitest'

import { loginRedirectFor } from './guard'
import { safeRedirectTarget } from './redirect'
import { signInErrorFrom } from './signInError'

describe('safeRedirectTarget', () => {
  it('keeps same-app paths', () => {
    expect(safeRedirectTarget('/properties?page=2')).toBe('/properties?page=2')
    expect(safeRedirectTarget('/leases/abc#terms')).toBe('/leases/abc#terms')
  })

  it('falls back to the dashboard for external, malformed or login targets', () => {
    for (const value of [undefined, 42, '', 'https://evil.example', '//evil.example', '/\\evil.example', 'properties', '/login', '/login?redirect=/']) {
      expect(safeRedirectTarget(value)).toBe('/')
    }
  })
})

describe('loginRedirectFor', () => {
  const at = (href: string) => ({ pathname: href.split('?')[0] ?? href, href })

  it('never redirects when signed in', () => {
    expect(loginRedirectFor({ status: 'authenticated' }, at('/properties'))).toBeNull()
  })

  it('sends signed-out users to /login and remembers where they were going', () => {
    expect(loginRedirectFor({ status: 'unauthenticated' }, at('/properties?page=2'))).toEqual({
      to: '/login',
      search: { redirect: '/properties?page=2' },
    })
    expect(loginRedirectFor({ status: 'unauthenticated' }, at('/'))).toEqual({ to: '/login', search: {} })
    expect(loginRedirectFor({ status: 'unauthenticated' }, at('/login'))).toBeNull()
  })
})

describe('signInErrorFrom', () => {
  it('maps provider errors to safe copy', () => {
    const invalid = Object.assign(new Error('Invalid login credentials'), { status: 400, code: 'invalid_credentials' })
    expect(signInErrorFrom(invalid).message).toBe('The email address or password is incorrect.')
    const limited = Object.assign(new Error('rate limited'), { status: 429 })
    expect(signInErrorFrom(limited).message).toMatch(/too many/i)
    const down = Object.assign(new Error('boom'), { status: 500 })
    expect(signInErrorFrom(down).message).toBe('Sign-in is unavailable right now. Try again shortly.')
  })
})
