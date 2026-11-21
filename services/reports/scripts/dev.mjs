#!/usr/bin/env node
/**
 * Reports service development runner (pnpm dev, or pnpm --filter @leaseguard/reports dev): the shared runner
 * (packages/service-kit/scripts/dev-runner.mjs) compiling into .dev-reports/ and running main.js.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { runDev } from '../../../packages/service-kit/scripts/dev-runner.mjs'

runDev({ root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), name: 'reports', entry: 'main.js', outDir: '.dev-reports' })
