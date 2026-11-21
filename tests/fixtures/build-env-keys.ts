import { execFileSync } from 'node:child_process'
import path from 'node:path'

/**
 * The list of variables a compiled service reads (`exportName` from `<buildDir>/config/env.js`).
 *
 * It is read in a plain `node` child process. Inside a Vitest worker, a native `require` of the build would
 * resolve workspace packages through the `@leaseguard/source` condition and load their TypeScript source,
 * which CommonJS cannot parse; the child resolves them to their built `dist` as the service itself does.
 */
export function envKeysFromBuild(buildDir: string, exportName: string): readonly string[] {
  const script = `const keys = require(${JSON.stringify(path.join(buildDir, 'config', 'env.js'))})[${JSON.stringify(exportName)}];
if (!Array.isArray(keys)) { console.error('config/env.js does not export ' + ${JSON.stringify(exportName)}); process.exit(2) }
process.stdout.write(JSON.stringify(keys))`
  const env = { ...process.env }
  delete env.NODE_OPTIONS
  const output = execFileSync(process.execPath, ['-e', script], { cwd: buildDir, env, encoding: 'utf8' })
  const parsed: unknown = JSON.parse(output)
  if (!Array.isArray(parsed)) throw new Error(`${buildDir}/config/env.js does not export ${exportName}`)
  return parsed.filter((key): key is string => typeof key === 'string')
}
