import path from 'node:path'

import { defineConfig, devices } from '@playwright/test'

import { resolveLocalSupabaseSync } from '../fixtures/local-supabase.ts'
import { REPO_ROOT, TEST_OUTPUT_ROOT } from '../fixtures/paths.ts'

import { E2E_API_URL, E2E_REPORTS_URL, E2E_WEB_PORT, E2E_WEB_URL } from './support/env.ts'

/**
 * The real stack: the LeaseGuard API (built from backend/ into backend/.dev-e2e, run with the reports service, the
 * statement worker and the document-processing service beside it) and the Vite dev server, whose gateway (ADR 0003)
 * sends /api/v1/reports to the reports service and every other API path to the API, all pointed at the LOCAL Supabase stack only. Refuses to start when Supabase is not local;
 * backend/.env and frontend/.env (which may name a hosted project) are never used for these processes.
 */
const supabase = resolveLocalSupabaseSync()

/** Specs that create or archive the world's portfolio records (see the projects below). */
const WRITES_PORTFOLIO = ['**/property-management.spec.ts', '**/portfolio-import.spec.ts']
/** The statements acceptance journey: adds units, tenants and leases and raises monitoring events (see below). */
const STATEMENTS_ACCEPTANCE = ['**/statements-acceptance.spec.ts']
/** The reports acceptance journey: adds a property with its units, tenants, leases and records to company A (see below). */
const REPORTS_ACCEPTANCE = ['**/reports-acceptance.spec.ts']

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
      testIgnore: [...WRITES_PORTFOLIO, ...STATEMENTS_ACCEPTANCE, ...REPORTS_ACCEPTANCE],
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
    // The statements acceptance journey runs last and alone: it adds units, tenants and leases to a world property,
    // and the statement worker raises monitoring events and notifications from them, which no other spec expects.
    {
      name: 'chromium-statements-acceptance',
      testMatch: STATEMENTS_ACCEPTANCE,
      dependencies: ['chromium-portfolio-writes'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    // The reports acceptance journey runs after that, alone: it adds a property (with its records) to company A, which
    // the specs asserting the world's exact property lists do not expect, and reads company-wide figures.
    {
      name: 'chromium-reports-acceptance',
      testMatch: REPORTS_ACCEPTANCE,
      dependencies: ['chromium-statements-acceptance'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, acceptDownloads: true },
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
      // Process variables override frontend/.env for Vite, so the browser only ever talks to local services. The web
      // app calls the dev server's own origin, and its gateway forwards each API path to the service that owns it.
      // Vite's own binary (not through pnpm), so stopping it on SIGTERM is not reported as a failure.
      command: `node node_modules/vite/bin/vite.js --port ${E2E_WEB_PORT} --strictPort`,
      cwd: path.join(REPO_ROOT, 'frontend'),
      url: E2E_WEB_URL,
      env: {
        VITE_API_URL: E2E_WEB_URL,
        GATEWAY_CORE_URL: E2E_API_URL,
        GATEWAY_REPORTS_URL: E2E_REPORTS_URL,
        VITE_SUPABASE_URL: supabase.url,
        VITE_SUPABASE_ANON_KEY: supabase.anonKey,
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
