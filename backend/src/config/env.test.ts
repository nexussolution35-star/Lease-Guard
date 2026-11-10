import { describe, expect, it } from 'vitest'

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  API_ENV_KEYS,
  InvalidEnvironmentError,
  loadApiEnv,
  loadEnvFileKeys,
  loadWorkerEnv,
  WHATSAPP_ACCESS_TOKEN_KEY,
  WORKER_ENV_KEYS,
} from './env'

const shared = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'info',
  SUPABASE_URL: 'http://127.0.0.1:54321',
  REDIS_URL: 'redis://127.0.0.1:6379',
  QUEUE_PREFIX: 'leaseguard',
  SUPABASE_STATEMENTS_BUCKET: 'statements',
  SUPABASE_LEASE_DOCUMENTS_BUCKET: 'lease-documents',
  DOCUMENT_PROCESSING_MAX_FILE_MB: '20',
}

const worker = {
  ...shared,
  SUPABASE_SERVICE_ROLE_KEY: '',
  DOCUMENT_PROCESSING_URL: 'http://127.0.0.1:8000',
  DOCUMENT_PROCESSING_TOKEN: 'local-dev-only-change-me',
  WHATSAPP_GRAPH_API_URL: 'https://graph.facebook.com',
  WHATSAPP_GRAPH_API_VERSION: 'v23.0',
  WEB_APP_URL: 'http://localhost:5173',
}

describe('loadApiEnv', () => {
  it('parses API configuration and splits CORS origins', () => {
    const env = loadApiEnv({
      ...shared,
      API_PORT: '3000',
      API_CORS_ORIGINS: 'http://localhost:5173, https://app.example.co.za',
      SUPABASE_ANON_KEY: '',
    })
    expect(env.API_PORT).toBe(3000)
    expect(env.API_CORS_ORIGINS).toEqual(['http://localhost:5173', 'https://app.example.co.za'])
    expect(env.SUPABASE_ANON_KEY).toBe('')
  })

  it('lists every missing variable and every invalid one', () => {
    const load = () => loadApiEnv({ ...shared, REDIS_URL: 'http://wrong', API_PORT: '3000' })
    expect(load).toThrow(InvalidEnvironmentError)
    expect(load).toThrow(/API_CORS_ORIGINS: missing/)
    expect(load).toThrow(/SUPABASE_ANON_KEY: missing/)
    expect(load).toThrow(/REDIS_URL: /)
  })

  const api = { ...shared, API_PORT: '3000', API_CORS_ORIGINS: 'http://localhost:5173', SUPABASE_ANON_KEY: '' }

  it('starts without Meta settings: each one is optional, and blank means unset', () => {
    const env = loadApiEnv({ ...api, WHATSAPP_APP_ID: '', WHATSAPP_APP_SECRET: '  ', WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID: '' })
    expect(env.WHATSAPP_APP_ID).toBeUndefined()
    expect(env.WHATSAPP_APP_SECRET).toBeUndefined()
    expect(env.WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID).toBeUndefined()
    expect(env.WHATSAPP_WEBHOOK_VERIFY_TOKEN).toBeUndefined()
  })

  it('reads the Meta app settings the API needs, requiring numeric Meta ids', () => {
    const env = loadApiEnv({
      ...api,
      WHATSAPP_APP_ID: ' 1234567890123456 ',
      WHATSAPP_APP_SECRET: 'app-secret',
      WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID: '987654321098765',
      WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'verify-token',
    })
    expect(env).toMatchObject({
      WHATSAPP_APP_ID: '1234567890123456',
      WHATSAPP_APP_SECRET: 'app-secret',
      WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID: '987654321098765',
      WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'verify-token',
    })
    expect(() => loadApiEnv({ ...api, WHATSAPP_APP_ID: 'my-app' })).toThrow(/WHATSAPP_APP_ID: /)
    expect(() => loadApiEnv({ ...api, WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID: 'abc' })).toThrow(/WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID: /)
  })
})

describe('loadWorkerEnv', () => {
  it('reads the optional Anthropic API key; blank means unset', () => {
    expect(loadWorkerEnv({ ...worker, ANTHROPIC_API_KEY: ' ' }).ANTHROPIC_API_KEY).toBeUndefined()
    expect(loadWorkerEnv({ ...worker, ANTHROPIC_API_KEY: 'sk-ant-test' }).ANTHROPIC_API_KEY).toBe('sk-ant-test')
  })

  it('does not require API-only variables', () => {
    const env = loadWorkerEnv(worker)
    expect(env.QUEUE_PREFIX).toBe('leaseguard')
    expect(env.DOCUMENT_PROCESSING_MAX_FILE_MB).toBe(20)
  })

  it('requires a long document-processing token in production', () => {
    expect(() => loadWorkerEnv({ ...worker, NODE_ENV: 'production' })).toThrow(/DOCUMENT_PROCESSING_TOKEN: must be at least 32/)
    expect(loadWorkerEnv({ ...worker, NODE_ENV: 'production', DOCUMENT_PROCESSING_TOKEN: 'x'.repeat(32), WEB_APP_URL: 'https://app.example.co.za' }).NODE_ENV).toBe('production')
  })

  it('requires the web app URL, without a trailing slash, query or fragment', () => {
    const { WEB_APP_URL: _omitted, ...withoutUrl } = worker
    expect(() => loadWorkerEnv(withoutUrl)).toThrow(/WEB_APP_URL: missing/)
    expect(loadWorkerEnv({ ...worker, WEB_APP_URL: 'https://app.example.co.za/' }).WEB_APP_URL).toBe('https://app.example.co.za')
    expect(loadWorkerEnv({ ...worker, WEB_APP_URL: 'https://example.co.za/leaseguard//' }).WEB_APP_URL).toBe('https://example.co.za/leaseguard')
    expect(() => loadWorkerEnv({ ...worker, WEB_APP_URL: 'ftp://app.example.co.za' })).toThrow(/WEB_APP_URL/)
    expect(() => loadWorkerEnv({ ...worker, WEB_APP_URL: 'not a url' })).toThrow(/WEB_APP_URL/)
    expect(() => loadWorkerEnv({ ...worker, WEB_APP_URL: 'https://app.example.co.za/?next=x' })).toThrow(/WEB_APP_URL: must not contain/)
  })

  it('requires an https web app URL in production', () => {
    const production = { ...worker, NODE_ENV: 'production', DOCUMENT_PROCESSING_TOKEN: 'x'.repeat(32) }
    expect(() => loadWorkerEnv(production)).toThrow(/WEB_APP_URL: must be an https URL in production/)
    expect(loadWorkerEnv({ ...production, WEB_APP_URL: 'https://app.example.co.za' }).WEB_APP_URL).toBe('https://app.example.co.za')
  })

  it('rejects a queue prefix containing the BullMQ key separator', () => {
    expect(() => loadWorkerEnv({ ...worker, QUEUE_PREFIX: 'a:b' })).toThrow(/QUEUE_PREFIX/)
  })
})

describe('loadEnvFileKeys', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'leaseguard-env-')), '.env')
  writeFileSync(file, 'SUPABASE_URL=https://example.supabase.co\nSUPABASE_SERVICE_ROLE_KEY=secret-value\nAPI_PORT=4000\n')

  it('keeps the service-role key out of the API process', () => {
    expect(API_ENV_KEYS).not.toContain('SUPABASE_SERVICE_ROLE_KEY')
    const target: NodeJS.ProcessEnv = {}
    loadEnvFileKeys(file, API_ENV_KEYS, target)
    expect(target).toEqual({ SUPABASE_URL: 'https://example.supabase.co', API_PORT: '4000' })
  })

  it('gives the worker its service-role key and never overrides the process environment', () => {
    expect(WORKER_ENV_KEYS).toContain('SUPABASE_SERVICE_ROLE_KEY')
    expect(WORKER_ENV_KEYS).toContain('WEB_APP_URL')
    expect(API_ENV_KEYS).not.toContain('WEB_APP_URL')
    const target: NodeJS.ProcessEnv = { SUPABASE_URL: 'http://already-set' }
    loadEnvFileKeys(file, WORKER_ENV_KEYS, target)
    expect(target).toEqual({ SUPABASE_URL: 'http://already-set', SUPABASE_SERVICE_ROLE_KEY: 'secret-value' })
  })

  it('gives only the worker the per-company WhatsApp tokens', () => {
    const tokens = join(mkdtempSync(join(tmpdir(), 'leaseguard-env-')), '.env')
    writeFileSync(
      tokens,
      [
        'WHATSAPP_ACCESS_TOKEN_3AB0FC4AEADB50B8BC4D5673ADA1519E=wa-1',
        // Only `_<company uuid hex, uppercase>` names are loaded: no bare, named, lowercase or short variants.
        'WHATSAPP_ACCESS_TOKEN=no',
        'WHATSAPP_ACCESS_TOKEN_NEXUS=no',
        'WHATSAPP_ACCESS_TOKEN_3ab0fc4aeadb50b8bc4d5673ada1519e=no',
        'WHATSAPP_ACCESS_TOKEN_3AB0FC4A-EADB-50B8-BC4D-5673ADA1519E=no',
        'WHATSAPP_ACCESS_TOKEN_3AB0FC4AEADB50B8BC4D5673ADA1519=no',
        'WHATSAPP_ACCESS_TOKENX=no',
        'OTHER_SECRET=no',
      ].join('\n'),
    )
    const worker: NodeJS.ProcessEnv = {}
    loadEnvFileKeys(tokens, WORKER_ENV_KEYS, worker, WHATSAPP_ACCESS_TOKEN_KEY)
    expect(worker).toEqual({ WHATSAPP_ACCESS_TOKEN_3AB0FC4AEADB50B8BC4D5673ADA1519E: 'wa-1' })
    const api: NodeJS.ProcessEnv = {}
    loadEnvFileKeys(tokens, API_ENV_KEYS, api)
    expect(api).toEqual({})
  })

  it('loads the Meta app secret and verify token into the API only, and the Anthropic key into the worker only', () => {
    for (const key of ['WHATSAPP_APP_ID', 'WHATSAPP_APP_SECRET', 'WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID', 'WHATSAPP_WEBHOOK_VERIFY_TOKEN']) {
      expect(API_ENV_KEYS).toContain(key)
      expect(WORKER_ENV_KEYS).not.toContain(key)
    }
    expect(WORKER_ENV_KEYS).toContain('ANTHROPIC_API_KEY')
    expect(API_ENV_KEYS).not.toContain('ANTHROPIC_API_KEY')
  })

  it('ignores a missing file', () => {
    const target: NodeJS.ProcessEnv = {}
    loadEnvFileKeys(join(tmpdir(), 'does-not-exist.env'), API_ENV_KEYS, target)
    expect(target).toEqual({})
  })
})
