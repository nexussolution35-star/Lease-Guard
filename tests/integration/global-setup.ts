import { createClient } from '@supabase/supabase-js'
import type { TestProject } from 'vitest/node'

import { assertLocal, resolveLocalSupabase } from '../fixtures/local-supabase.ts'
import { createWorld, destroyWorld, type World, type WorldUserKey } from '../fixtures/world.ts'
import { apiBuild, apiEnvironment, buildApi, freePort, removeApiBuild, startApi, type RunningApi } from '../fixtures/api-server.ts'
import { assertRedisReachable, deleteKeysWithPrefix } from '../fixtures/redis.ts'
import './support/context.ts'

const API_BUILD = apiBuild('integration')

const log = (message: string) => console.log(`[integration] ${message}`)

/** Redis for BullMQ. The documented local default; override with INTEGRATION_REDIS_URL (must be local). */
const REDIS_URL = process.env.INTEGRATION_REDIS_URL ?? 'redis://127.0.0.1:6379'

async function signIn(url: string, anonKey: string, world: World, user: WorldUserKey): Promise<string> {
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { email, password } = world.users[user]
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error || !data.session) {
    throw new Error(`Signing in the test user ${email} on the local stack failed (${error?.message ?? 'no session'}).`)
  }
  return data.session.access_token
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const queuePrefix = `lg-it-${process.pid}-${Date.now().toString(36)}`

  // 1. Prerequisites: local Supabase (never the hosted project in .env) and Redis. Fail fast.
  const supabase = await resolveLocalSupabase()
  assertLocal('REDIS_URL', REDIS_URL)
  await assertRedisReachable(REDIS_URL)
  log(`local Supabase at ${supabase.url}, Redis at ${new URL(REDIS_URL).host}, queue prefix ${queuePrefix}`)

  // 2. This run's data: two companies, four users and their records, created with the service role.
  const world = await createWorld(supabase, { label: 'it' })
  log(`created world ${world.runId}: companies ${world.companies.a.id} (A) and ${world.companies.b.id} (B), ${Object.keys(world.users).length} users`)

  let api: RunningApi | undefined
  const teardown = async () => {
    await api?.stop()
    removeApiBuild(API_BUILD)
    const deleted = await deleteKeysWithPrefix(REDIS_URL, queuePrefix)
    log(`stopped the API, removed backend/.dev-integration, deleted ${deleted} Redis key(s) under ${queuePrefix}:`)
    const report = await destroyWorld(supabase, world)
    log(
      `removed world ${world.runId} and verified nothing is left: ${report.storageObjectsRemoved} storage object(s), ` +
        `${report.companiesDeleted} compan(ies) deleted, ${report.companiesArchived} archived, ` +
        `${report.usersDeleted} user(s) deleted, ${report.usersDeactivated} deactivated`,
    )
    if (report.companiesArchived + report.usersDeactivated > 0) {
      log('audit_logs is append-only and references companies and actors: those are kept emptied, archived or deactivated')
    }
  }

  let accessTokens: Record<WorldUserKey, string>
  try {
    accessTokens = {
      admin: await signIn(supabase.url, supabase.anonKey, world, 'admin'),
      manager: await signIn(supabase.url, supabase.anonKey, world, 'manager'),
      readOnly: await signIn(supabase.url, supabase.anonKey, world, 'readOnly'),
      owner: await signIn(supabase.url, supabase.anonKey, world, 'owner'),
    }

    // 3. Compile and start the real API with an explicit environment.
    log('building @leaseguard/domain (if stale) and the API into backend/.dev-integration …')
    await buildApi(API_BUILD)
    const port = await freePort()
    const env = apiEnvironment(API_BUILD, {
      API_PORT: String(port),
      SUPABASE_URL: supabase.url,
      SUPABASE_ANON_KEY: supabase.anonKey,
      REDIS_URL,
      QUEUE_PREFIX: queuePrefix,
    })
    api = await startApi(API_BUILD, env)
    log(`API ready at ${api.baseUrl} (pid ${api.pid}); log: tests/test-results/integration/api.log`)
  } catch (error) {
    await teardown().catch((cleanupError: unknown) => console.error('[integration] teardown after a failed setup failed:', cleanupError))
    throw error
  }

  project.provide('integration', {
    apiBaseUrl: api.baseUrl,
    supabaseUrl: supabase.url,
    anonKey: supabase.anonKey,
    serviceRoleKey: supabase.serviceRoleKey,
    world,
    accessTokens,
    redisUrl: REDIS_URL,
    queuePrefix,
    runId: world.runId,
  })
  return teardown
}
