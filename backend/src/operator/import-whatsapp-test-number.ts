/**
 * Entry point of the number import operator command (ticket 15): `pnpm whatsapp:import-test-number` builds the backend
 * and runs this file (infrastructure/scripts/whatsapp-import-test-number.mjs); in a deployed backend image it is
 * `node dist/operator/import-whatsapp-test-number.js`. Everything else is in cli.ts.
 */
import { main } from './cli'

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code
    // Let the output flush; never hang on a connection that cannot close (Redis down).
    setTimeout(() => process.exit(code), 3_000).unref()
  },
  (error: unknown) => {
    console.error(`whatsapp:import-test-number: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  },
)
