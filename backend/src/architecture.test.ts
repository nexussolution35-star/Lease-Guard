import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Dependency direction between the backend's top-level folders. The API (modules/) and the workers
 * (workers/) are two callers of the same shared modules; if either imports the other, a change behind
 * one caller's interface silently reaches the other and the shared seam loses its locality. Shared code
 * they both need lives in messaging/, infrastructure/ or common/, which import neither caller.
 * Test files count too: a test that reaches across leaks the coupling back in. Operator commands (operator/) are a
 * third caller and use the shared folders only.
 */
const FORBIDDEN: Readonly<Record<string, readonly string[]>> = {
  modules: ['workers', 'operator'],
  workers: ['modules', 'operator'],
  messaging: ['modules', 'workers', 'operator'],
  infrastructure: ['modules', 'workers', 'messaging', 'operator'],
  common: ['modules', 'workers', 'messaging', 'operator'],
  config: ['modules', 'workers', 'messaging', 'operator'],
  operator: ['modules', 'workers'],
}

const SRC = __dirname

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return entry.name.endsWith('.ts') ? [path] : []
  })
}

/** Top-level folder under src/ that a path belongs to; undefined for files directly in src/. */
function topFolder(path: string): string | undefined {
  const parts = relative(SRC, path).split(sep)
  return parts.length > 1 ? parts[0] : undefined
}

/** Relative specifiers of static imports, re-exports, dynamic imports and vi.mock paths. */
function relativeImports(source: string): string[] {
  const pattern = /(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+|\bvi\.mock\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g
  return [...source.matchAll(pattern)].map((match) => match[1] ?? '')
}

function violations(): string[] {
  return Object.entries(FORBIDDEN).flatMap(([folder, forbidden]) =>
    sourceFiles(join(SRC, folder)).flatMap((file) =>
      relativeImports(readFileSync(file, 'utf8'))
        .filter((specifier) => {
          const target = topFolder(resolve(dirname(file), specifier))
          return target !== undefined && forbidden.includes(target)
        })
        .map((specifier) => `${relative(SRC, file)} imports ${specifier}`),
    ),
  )
}

describe('backend dependency direction', () => {
  it('keeps modules/ and workers/ independent and the shared folders below both', () => {
    expect(violations()).toEqual([])
  })

  it('recognises every import form it checks', () => {
    const source = [
      "import { a } from '../workers/a'",
      "export { b } from '../../modules/b'",
      "import '../c'",
      "const d = await import('./d')",
      "vi.mock('../e', () => ({}))",
    ].join('\n')
    expect(relativeImports(source)).toEqual(['../workers/a', '../../modules/b', '../c', './d', '../e'])
  })
})
