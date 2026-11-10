import type { LocalSupabase } from '../../fixtures/local-supabase.ts'
import type { World, WorldUser } from '../../fixtures/world.ts'

/** Passed from global setup to the test workers through the environment. */
export const E2E_CONTEXT_VARIABLE = 'LEASEGUARD_E2E_CONTEXT'

export interface E2EContext {
  supabase: LocalSupabase
  world: World
}

/** The world created for this run by global-setup.ts. */
export function e2eContext(): E2EContext {
  const raw = process.env[E2E_CONTEXT_VARIABLE]
  if (!raw) throw new Error(`${E2E_CONTEXT_VARIABLE} is not set: run the suite with \`pnpm test:e2e\` (global setup creates the world)`)
  return JSON.parse(raw) as E2EContext
}

export function e2eWorld(): World {
  return e2eContext().world
}

export function e2eUser(key: WorldUser['key']): WorldUser {
  return e2eWorld().users[key]
}
