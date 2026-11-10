import { loadApiEnv, type ApiEnv } from '../../config/env'
import type { DbClient } from '../database/rls-client.factory'
import type { StorageErrorLike } from './storage.service'

/** A valid API configuration for unit tests (20 MB statement limit, bucket `statements`). */
export function testApiEnv(overrides: Partial<Record<string, string>> = {}): ApiEnv {
  return loadApiEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    SUPABASE_URL: 'http://127.0.0.1:54321',
    REDIS_URL: 'redis://127.0.0.1:6379',
    QUEUE_PREFIX: 'leaseguard-test',
    SUPABASE_STATEMENTS_BUCKET: 'statements',
    SUPABASE_LEASE_DOCUMENTS_BUCKET: 'lease-documents',
    DOCUMENT_PROCESSING_MAX_FILE_MB: '20',
    API_PORT: '3000',
    API_CORS_ORIGINS: 'http://localhost:5173',
    SUPABASE_ANON_KEY: 'test-anon-key',
    ...overrides,
  })
}

export interface StorageCall {
  bucket: string
  method: string
  args: unknown[]
}

type StorageResult = { data: unknown; error: StorageErrorLike | null }

/**
 * Test-only Supabase client exposing `storage.from(bucket)`. Every bucket method call is recorded and
 * resolves to `respond(call)`.
 */
export function fakeStorageDb(respond: (call: StorageCall) => StorageResult): { client: DbClient; calls: StorageCall[] } {
  const calls: StorageCall[] = []
  const client = {
    storage: {
      from(bucket: string) {
        return new Proxy(
          {},
          {
            get(_target, method) {
              return (...args: unknown[]) => {
                const call: StorageCall = { bucket, method: String(method), args }
                calls.push(call)
                return Promise.resolve(respond(call))
              }
            },
          },
        )
      },
    },
  }
  return { client: client as unknown as DbClient, calls }
}
