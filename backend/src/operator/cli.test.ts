import { describe, expect, it } from 'vitest'

import { describeTarget, parseImportArgs, UsageError } from './cli'

describe('parseImportArgs', () => {
  it('is a dry run unless --apply is given', () => {
    expect(parseImportArgs(['--company', 'NS'])).toEqual({ help: false, company: 'NS', apply: false, yes: false, hosted: false })
    expect(parseImportArgs(['--company', '3ab0fc4a-eadb-50b8-bc4d-5673ada1519e', '--apply', '--yes'])).toMatchObject({ apply: true, yes: true })
  })

  it('accepts the arguments pnpm forwards after --', () => {
    expect(parseImportArgs(['--', '--company', 'NS', '--apply'])).toMatchObject({ company: 'NS', apply: true })
  })

  it('needs a company by id or initials, and refuses anything else', () => {
    expect(() => parseImportArgs([])).toThrow(UsageError)
    expect(() => parseImportArgs(['--company', 'Nexus Solution'])).toThrow(/id .* or its two-letter initials/)
    expect(() => parseImportArgs(['--company', 'NS', '--token', 'x'])).toThrow(UsageError)
    expect(() => parseImportArgs(['--yes', '--company', 'NS'])).toThrow(/--yes only applies with --apply/)
  })

  it('shows help', () => {
    expect(parseImportArgs(['--help'])).toEqual({ help: true })
  })
})

describe('describeTarget', () => {
  it('names the local stack', () => {
    expect(describeTarget('http://127.0.0.1:54321', false)).toEqual({ hosted: false, target: 'local Supabase (127.0.0.1:54321)' })
  })

  it('refuses a hosted project unless --hosted is given', () => {
    expect(() => describeTarget('https://abcdefghijklmnopqrst.supabase.co', false)).toThrow(/--hosted/)
    expect(describeTarget('https://abcdefghijklmnopqrst.supabase.co', true)).toEqual({
      hosted: true,
      target: 'HOSTED Supabase (abcdefghijklmnopqrst.supabase.co)',
    })
  })
})
