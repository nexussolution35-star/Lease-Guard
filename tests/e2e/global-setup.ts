import { resolveLocalSupabase } from '../fixtures/local-supabase.ts'
import { createWorld, destroyWorld } from '../fixtures/world.ts'

import { E2E_CONTEXT_VARIABLE, type E2EContext } from './support/world.ts'

const log = (message: string) => console.log(`[e2e] ${message}`)

/**
 * Creates this run's world (users, two companies, properties …) on the LOCAL stack and removes it
 * again when the run ends. The database may otherwise be empty: no test relies on seeded rows.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const supabase = await resolveLocalSupabase()
  const world = await createWorld(supabase, { label: 'e2e' })
  log(`created world ${world.runId} (companies ${world.companies.a.tradingName}, ${world.companies.b.tradingName})`)
  const context: E2EContext = { supabase, world }
  process.env[E2E_CONTEXT_VARIABLE] = JSON.stringify(context)

  return async () => {
    const report = await destroyWorld(supabase, world)
    log(`removed world ${world.runId}: ${JSON.stringify(report)}`)
  }
}
