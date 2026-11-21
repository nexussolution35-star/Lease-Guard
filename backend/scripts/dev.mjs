#!/usr/bin/env node
/**
 * Backend development runner (the shared runner: packages/service-kit/scripts/dev-runner.mjs).
 *
 *   node scripts/dev.mjs api      (pnpm dev)          HTTP API, entry main.js, output .dev-api/
 *   node scripts/dev.mjs worker   (pnpm dev:worker)   BullMQ worker, entry worker.js, output .dev-worker/
 */
import { runDev } from '../../packages/service-kit/scripts/dev-runner.mjs'
import { BACKEND_ROOT } from './domain-build.mjs'

const TARGETS = {
  api: { entry: 'main.js', outDir: '.dev-api' },
  worker: { entry: 'worker.js', outDir: '.dev-worker' },
}

const targetName = process.argv[2]
const target = Object.hasOwn(TARGETS, targetName ?? '') ? TARGETS[targetName] : undefined
if (!target) {
  console.error(`Usage: node scripts/dev.mjs <${Object.keys(TARGETS).join('|')}>`)
  process.exit(2)
}

runDev({ root: BACKEND_ROOT, name: targetName, ...target })
