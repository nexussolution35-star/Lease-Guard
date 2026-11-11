import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

/** Workspace packages publish TypeScript source under this export condition (no stale dist). */
const WORKSPACE_SOURCE = '@leaseguard/source'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  // Keep Vite/Vitest caches in the package's node_modules, not in a node_modules under integration/.
  cacheDir: fileURLToPath(new URL('../node_modules/.vite/integration', import.meta.url)),
  // The acceptance scenario runs the worker's processors in this process; their NestJS decorators (legacy, with
  // parameter decorators) must compile. The processors are constructed by hand, so no decorator metadata is needed.
  oxc: { decorator: { legacy: true } },
  resolve: { conditions: [WORKSPACE_SOURCE] },
  ssr: { resolve: { conditions: [WORKSPACE_SOURCE] } },
  test: {
    name: 'integration',
    environment: 'node',
    include: ['**/*.test.ts'],
    globalSetup: ['./global-setup.ts'],
    // Files share one API process and one database; run them one after another so the row restores
    // of one file never interleave with the reads of another.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // A missing prerequisite must fail the run, never pass it vacuously.
    passWithNoTests: false,
  },
})
