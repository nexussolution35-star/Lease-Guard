import { describe, expect, it } from 'vitest'

import { findExposedSecrets, isSupabaseSecretKey } from './exposedSecrets'

function jwt(payload: object): string {
  const encode = (value: object) => btoa(JSON.stringify(value)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.signature`
}

describe('isSupabaseSecretKey', () => {
  it('recognises secret keys and service-role JWTs', () => {
    expect(isSupabaseSecretKey('sb_secret_abc123')).toBe(true)
    expect(isSupabaseSecretKey(` ${jwt({ role: 'service_role', iss: 'supabase' })} `)).toBe(true)
  })

  it('accepts public keys and anything else', () => {
    expect(isSupabaseSecretKey('sb_publishable_abc123')).toBe(false)
    expect(isSupabaseSecretKey(jwt({ role: 'anon', iss: 'supabase' }))).toBe(false)
    expect(isSupabaseSecretKey('not.a.jwt')).toBe(false)
    expect(isSupabaseSecretKey('http://127.0.0.1:3000')).toBe(false)
    expect(isSupabaseSecretKey('')).toBe(false)
  })
})

describe('findExposedSecrets', () => {
  it('reports only VITE_ variable names, never values', () => {
    const env = {
      VITE_SUPABASE_ANON_KEY: 'sb_secret_leaked',
      VITE_OTHER: jwt({ role: 'service_role' }),
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_ok',
      SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_server_only',
      VITE_COUNT: 3,
    }
    expect(findExposedSecrets(env)).toEqual(['VITE_OTHER', 'VITE_SUPABASE_ANON_KEY'])
  })
})

describe('findExposedSecrets: server-only settings', () => {
  it('refuses a VITE_ copy of a server-only setting by name, whatever its value', () => {
    const env = {
      VITE_WHATSAPP_APP_SECRET: 'x',
      VITE_WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'y',
      VITE_ANTHROPIC_API_KEY: 'z',
      VITE_SUPABASE_SERVICE_ROLE_KEY: 'w',
      VITE_WHATSAPP_ACCESS_TOKEN_3AB0FC4AEADB50B8BC4D5673ADA1519E: 'v',
      VITE_WHATSAPP_APP_ID: '1234567890',
    }
    expect(findExposedSecrets(env)).toEqual([
      'VITE_ANTHROPIC_API_KEY',
      'VITE_SUPABASE_SERVICE_ROLE_KEY',
      'VITE_WHATSAPP_ACCESS_TOKEN_3AB0FC4AEADB50B8BC4D5673ADA1519E',
      'VITE_WHATSAPP_APP_SECRET',
      'VITE_WHATSAPP_WEBHOOK_VERIFY_TOKEN',
    ])
  })

  it('refuses any VITE_ value equal to a server-only secret, and anything shaped like an Anthropic key', () => {
    const env = { VITE_WHATSAPP_APP_ID: 'meta-app-secret', VITE_HELP: 'sk-ant-api03-abc', VITE_API_URL: 'http://127.0.0.1:3000' }
    expect(findExposedSecrets(env, { WHATSAPP_APP_SECRET: 'meta-app-secret', WHATSAPP_WEBHOOK_VERIFY_TOKEN: '' })).toEqual([
      'VITE_HELP',
      'VITE_WHATSAPP_APP_ID',
    ])
  })
})
