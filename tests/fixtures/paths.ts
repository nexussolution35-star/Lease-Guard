import { fileURLToPath } from 'node:url'
import path from 'node:path'

/** Repository root (this file lives in tests/fixtures). */
export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
export const TESTS_ROOT = path.join(REPO_ROOT, 'tests')
export const BACKEND_ROOT = path.join(REPO_ROOT, 'backend')
/** Output of both suites (logs, Playwright traces). Ignored by git (`test-results/`). */
export const TEST_OUTPUT_ROOT = path.join(TESTS_ROOT, 'test-results')
/** The Supabase CLI pinned in the root package.json. */
export const SUPABASE_BIN = path.join(REPO_ROOT, 'node_modules', '.bin', 'supabase')
