import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Tenant messages always require approval (a hard constraint, ADR 0001), so neither the published API
 * contract nor the backend's own descriptions may present it as a company setting. Generated text
 * (openapi.json, the api-client schema) is copied from controller and DTO descriptions, so a stale
 * comment there would tell clients that approval can be switched off.
 */
// Phrases may wrap across comment lines or concatenated strings, so the gaps between words allow those too.
const GAP = String.raw`[\s*'"+-]+`
const APPROVAL_KNOB = new RegExp(
  `require_?approval_?for_?tenant_?messages|tenant${GAP}message${GAP}approval${GAP}(?:switch|setting|toggle|flag)`,
  'gi',
)

const BACKEND_SRC = resolve(__dirname, '../..')
const PUBLISHED_CONTRACT = [
  resolve(BACKEND_SRC, '../openapi.json'),
  resolve(BACKEND_SRC, '../../packages/api-client/src/generated/schema.ts'),
]

function productionSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return productionSources(path)
    // Tests may name the removed knob on purpose, to prove a request carrying it is refused.
    return entry.name.endsWith('.ts') && !/\.test(-helpers)?\.ts$/.test(entry.name) ? [path] : []
  })
}

function linesMentioningKnob(path: string): string[] {
  const text = readFileSync(path, 'utf8')
  return [...text.matchAll(APPROVAL_KNOB)].map(
    (match) => `${relative(BACKEND_SRC, path)}:${text.slice(0, match.index).split('\n').length}`,
  )
}

describe('tenant-message approval in the API contract', () => {
  it('is never described as a setting in the published contract', () => {
    expect(PUBLISHED_CONTRACT.flatMap(linesMentioningKnob)).toEqual([])
  })

  it('is never described as a setting in backend sources the contract is generated from', () => {
    expect(productionSources(BACKEND_SRC).flatMap(linesMentioningKnob)).toEqual([])
  })

  it('recognises the ways the knob has been written', () => {
    const knobs = [
      'the tenant-message approval switch',
      'the tenant\n * message approval switch',
      "the tenant-message approval ' +\n      'switch",
      'requireApprovalForTenantMessages',
      'require_approval_for_tenant_messages',
    ]
    for (const text of knobs) expect(text.match(APPROVAL_KNOB)).toHaveLength(1)
    expect('Tenant messages always require approval; it is not a company setting.'.match(APPROVAL_KNOB)).toBeNull()
  })
})
