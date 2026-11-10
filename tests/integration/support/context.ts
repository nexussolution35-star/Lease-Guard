import type { World, WorldUserKey } from '../../fixtures/world.ts'

/** What the global setup hands to every test file (`inject('integration')`). */
export interface IntegrationContext {
  /** Origin of the API process started for this run. */
  apiBaseUrl: string
  supabaseUrl: string
  anonKey: string
  /** Setup and cleanup only (bypasses RLS). Never used to call the API. */
  serviceRoleKey: string
  /** The companies, users and records this run created (tests/fixtures/world.ts). */
  world: World
  /** Access tokens of the world's users, signed in once per run (local Auth rate-limits sign-ins). */
  accessTokens: Record<WorldUserKey, string>
  redisUrl: string
  /** BullMQ prefix of this run's API process; every key under it is deleted at teardown. */
  queuePrefix: string
  /** Unique per run (the world's runId); used in names of records the tests create. */
  runId: string
}

declare module 'vitest' {
  export interface ProvidedContext {
    integration: IntegrationContext
  }
}
