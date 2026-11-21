#!/usr/bin/env node
/**
 * Reports worker development runner (pnpm dev, or pnpm --filter @leaseguard/reports dev:worker): the shared runner
 * (packages/service-kit/scripts/dev-runner.mjs) compiling into .dev-reports-worker/ and running worker.js, the
 * process that computes and hands over the weekly owner summaries (ticket R-07).
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { runDev } from '../../../packages/service-kit/scripts/dev-runner.mjs'

runDev({ root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), name: 'reports-worker', entry: 'worker.js', outDir: '.dev-reports-worker' })
