/// <reference types="vitest/config" />
import { defineConfig, defaultClientConditions, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import path from 'node:path'

import { exposedSecretsMessage, findExposedSecrets } from './src/services/api/exposedSecrets.ts'

// Workspace packages publish TypeScript source under this export condition,
// so the frontend compiles them directly without a separate build step.
const WORKSPACE_SOURCE_CONDITION = '@leaseguard/source'

// One `.env` for every process lives at the repository root; only VITE_* variables reach the
// browser and are validated in src/services/api/config.ts.
const ENV_DIR = path.resolve(import.meta.dirname, '..')

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Refuse to serve or build when a VITE_* variable holds a Supabase secret: it would be bundled.
  const exposed = findExposedSecrets(loadEnv(mode, ENV_DIR, 'VITE_'))
  if (exposed.length > 0) throw new Error(`Refusing to start: ${exposedSecretsMessage(exposed)}`)

  return {
    envDir: ENV_DIR,
    plugins: [
      // Route generation options live in tsr.config.json, shared with the `tsr` CLI.
      tanstackRouter(),
      react(),
      tailwindcss(),
    ],
    resolve: {
      alias: { '@': path.resolve(import.meta.dirname, './src') },
      conditions: [WORKSPACE_SOURCE_CONDITION, ...defaultClientConditions],
    },
    test: {
      globals: true,
      environment: 'jsdom',
      include: ['src/**/*.{test,spec}.{ts,tsx}'],
      setupFiles: ['./src/test/setup.ts'],
      // Fixed, unreachable endpoints: unit tests never use the developer's .env and never reach a
      // real API or Supabase project (tests fake the API client or the source they exercise).
      env: {
        VITE_API_URL: 'http://api.test',
        VITE_SUPABASE_URL: 'http://supabase.test',
        VITE_SUPABASE_ANON_KEY: 'test-anon-key',
      },
    },
  }
})
