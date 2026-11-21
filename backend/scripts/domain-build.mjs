#!/usr/bin/env node
/**
 * Makes sure the workspace packages the backend runs on (`@leaseguard/domain`, `@leaseguard/service-kit`) are
 * compiled before the backend is compiled or run. The logic is shared by every service:
 * packages/service-kit/scripts/workspace-build.mjs. This entry point keeps the backend's own command:
 *
 *   node scripts/domain-build.mjs           build each package unless its dist is up to date
 *   node scripts/domain-build.mjs --force   always build them
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { ensureWorkspaceBuilt, REPO_ROOT } from '../../packages/service-kit/scripts/workspace-build.mjs'

export const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export { REPO_ROOT }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  ensureWorkspaceBuilt({ force: process.argv.includes('--force') }).catch((error) => {
    console.error(`[workspace-build] ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  })
}
