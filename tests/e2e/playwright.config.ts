import path from 'node:path'

import { defineConfig, devices } from '@playwright/test'

import { resolveLocalSupabaseSync } from '../fixtures/local-supabase.ts'
import { REPO_ROOT, TEST_OUTPUT_ROOT } from '../fixtures/paths.ts'

import { E2E_API_URL, E2E_WEB_PORT, E2E_WEB_URL } from './support/env.ts'

/**
 * The real stack: the LeaseGuard API (built from backend/ into backend/.dev-e2e) and the Vite dev
 * server, both pointed at the LOCAL Supabase stack only. Refuses to start when Supabase is not local;
 * the repository-root .env (which may name a hosted project) is never used for these processes.
 */
const supabase = resolveLocalSupabaseSync()

/** Specs that create or archive the world's portfolio records (see the projects below). */
const WRITES_PORTFOLIO = '**/property-management.spec.ts'

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  outputDir: `${TEST_OUTPUT_ROOT}/e2e/results`,
  globalSetup: './global-setup.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: process.env.CI ? 1 : 2,
  reporter: [['list']],
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: E2E_WEB_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: WRITES_PORTFOLIO,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    // Specs that add or archive portfolio records run after every other spec: several specs assert the
    // world's exact property lists, and files in the first project run in parallel.
    {
      name: 'chromium-portfolio-writes',
      testMatch: WRITES_PORTFOLIO,
      dependencies: ['chromium'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: [
    {
      // Builds and runs the API; on stop it removes backend/.dev-e2e and the run's Redis keys.
      command: 'node tests/e2e/support/run-api.ts',
      cwd: REPO_ROOT,
      url: `${E2E_API_URL}/health/ready`,
      reuseExistingServer: false,
      timeout: 180_000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 20_000 },
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      // Process variables override the root .env for Vite, so the browser only ever talks to local services.
      // Vite's own binary (not through pnpm), so stopping it on SIGTERM is not reported as a failure.
      command: `node node_modules/vite/bin/vite.js --port ${E2E_WEB_PORT} --strictPort`,
      cwd: path.join(REPO_ROOT, 'frontend'),
      url: E2E_WEB_URL,
      env: {
        VITE_API_URL: E2E_API_URL,
        VITE_SUPABASE_URL: supabase.url,
        VITE_SUPABASE_ANON_KEY: supabase.anonKey,
        // No Google address suggestions in browser tests (no external calls, no billing). Set
        // E2E_GOOGLE_MAPS_API_KEY to try them against Google on purpose.
        VITE_GOOGLE_MAPS_API_KEY: process.env.E2E_GOOGLE_MAPS_API_KEY ?? '',
      },
      // Never test a server this run did not start.
      reuseExistingServer: false,
      timeout: 120_000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
})
