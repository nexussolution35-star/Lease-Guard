import { describe, expect, it } from 'vitest'

import { ConfigError, getAppConfig, parseAppConfig } from './config'

const ENV = {
  VITE_API_URL: 'http://127.0.0.1:3000/',
  VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
  VITE_SUPABASE_ANON_KEY: 'public-anon-key',
}

describe('parseAppConfig', () => {
  it('accepts a complete configuration and trims trailing slashes', () => {
    expect(parseAppConfig(ENV)).toEqual({
      ok: true,
      config: { apiUrl: 'http://127.0.0.1:3000', supabaseUrl: 'http://127.0.0.1:54321', supabaseAnonKey: 'public-anon-key' },
    })
  })

  it('reports every missing variable (unset and empty are both missing)', () => {
    const result = parseAppConfig({ VITE_SUPABASE_ANON_KEY: '' })
    expect(result).toEqual({
      ok: false,
      issues: ['VITE_API_URL is required', 'VITE_SUPABASE_URL is required', 'VITE_SUPABASE_ANON_KEY is required'],
    })
  })

  it('rejects non-http URLs', () => {
    expect(parseAppConfig({ ...ENV, VITE_API_URL: 'ftp://api.example' })).toEqual({
      ok: false,
      issues: ['VITE_API_URL must be an http(s) URL'],
    })
  })

  it('ignores unknown VITE_ variables, such as a leftover VITE_DATA_SOURCE', () => {
    const result = parseAppConfig({ ...ENV, VITE_DATA_SOURCE: 'demo', VITE_SOMETHING_ELSE: 'x' })
    expect(result.ok).toBe(true)
  })
})

describe('parseAppConfig secret guard', () => {
  it('refuses to start when a VITE_ variable holds a secret key, naming only the variable', () => {
    const result = parseAppConfig({ ...ENV, VITE_SUPABASE_ANON_KEY: 'sb_secret_leaked' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues.join(' ')).toContain('VITE_SUPABASE_ANON_KEY')
      expect(result.issues.join(' ')).not.toContain('sb_secret_leaked')
    }
  })

  it('checks unknown VITE_ variables for secrets too', () => {
    const result = parseAppConfig({ ...ENV, VITE_EXTRA: 'sb_secret_leaked' })
    expect(result.ok).toBe(false)
  })
})

describe('getAppConfig', () => {
  it('throws a ConfigError listing the issues for an invalid configuration', () => {
    expect(() => getAppConfig(parseAppConfig({}))).toThrow(ConfigError)
  })

  it('returns the configuration when valid', () => {
    expect(getAppConfig(parseAppConfig(ENV)).apiUrl).toBe('http://127.0.0.1:3000')
  })

  it('passes an optional Google Maps key through, and leaves it out when blank', () => {
    const withKey = parseAppConfig({ ...ENV, VITE_GOOGLE_MAPS_API_KEY: ' browser-key ' })
    expect(withKey.ok && withKey.config.googleMapsApiKey).toBe('browser-key')
    const blank = parseAppConfig({ ...ENV, VITE_GOOGLE_MAPS_API_KEY: '' })
    expect(blank.ok && blank.config).not.toHaveProperty('googleMapsApiKey')
  })
})
