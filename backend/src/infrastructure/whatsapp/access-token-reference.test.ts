import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { WHATSAPP_ACCESS_TOKEN_KEY as CONFIG_KEY } from '../../config/env'
import { envAccessTokenVariable, parseAccessTokenReference, WHATSAPP_ACCESS_TOKEN_KEY } from './access-token-reference'

/**
 * SQL/TypeScript parity: the pgTAP test checks `private.is_whatsapp_token_reference` against the case
 * table between the reference-parity markers; this test reads the same lines and checks the parser.
 * Adding a case on either side is therefore checked on both.
 */
const PGTAP_FILE = resolve(__dirname, '../../../../supabase/tests/whatsapp_channel.test.sql')

function parityCases(): { reference: string; companyId: string; accepted: boolean }[] {
  const sql = readFileSync(PGTAP_FILE, 'utf8')
  const block = /-- reference-parity-cases:begin\n([\s\S]*?)-- reference-parity-cases:end/.exec(sql)?.[1]
  if (!block) throw new Error(`No reference-parity-cases block in ${PGTAP_FILE}`)
  return [...block.matchAll(/^\s*\('((?:[^']|'')*)', '([0-9a-f-]{36})', (true|false)\)[,;]$/gm)].map(([, reference, companyId, accepted]) => ({
    reference: reference!.replaceAll("''", "'"),
    companyId: companyId!,
    accepted: accepted === 'true',
  }))
}

describe('access token references', () => {
  const cases = parityCases()

  it('reads every case line of the pgTAP parity table', () => {
    const sql = readFileSync(PGTAP_FILE, 'utf8')
    const block = /-- reference-parity-cases:begin\n([\s\S]*?)-- reference-parity-cases:end/.exec(sql)![1]!
    expect(cases.length).toBe(block.split('\n').filter((line) => line.trim().startsWith('(')).length)
    expect(cases.filter((c) => c.accepted).length).toBeGreaterThanOrEqual(3)
    expect(cases.filter((c) => !c.accepted).length).toBeGreaterThanOrEqual(10)
  })

  it.each(cases)('agrees with the database on %j', ({ reference, companyId, accepted }) => {
    expect(parseAccessTokenReference(reference, companyId) !== null).toBe(accepted)
  })

  it('names the env variable after the company uuid, without dashes, in uppercase', () => {
    const nexus = '3ab0fc4a-eadb-50b8-bc4d-5673ada1519e'
    expect(envAccessTokenVariable(nexus)).toBe('WHATSAPP_ACCESS_TOKEN_3AB0FC4AEADB50B8BC4D5673ADA1519E')
    expect(envAccessTokenVariable(nexus.toUpperCase())).toBe('WHATSAPP_ACCESS_TOKEN_3AB0FC4AEADB50B8BC4D5673ADA1519E')
    expect(envAccessTokenVariable('cmp_nexus')).toBeNull()
    expect(parseAccessTokenReference('secret://env/WHATSAPP_ACCESS_TOKEN_3AB0FC4AEADB50B8BC4D5673ADA1519E', nexus)).toEqual({
      kind: 'env',
      variable: 'WHATSAPP_ACCESS_TOKEN_3AB0FC4AEADB50B8BC4D5673ADA1519E',
    })
    expect(parseAccessTokenReference('secret://vault/3f0c1a52-8d4e-4b7a-9c61-2e5d7f9a0b13', nexus)).toEqual({
      kind: 'vault',
      secretId: '3f0c1a52-8d4e-4b7a-9c61-2e5d7f9a0b13',
    })
  })

  it('loads exactly the variables a company reference can name (config/env.ts uses this pattern)', () => {
    expect(CONFIG_KEY).toBe(WHATSAPP_ACCESS_TOKEN_KEY)
    expect(WHATSAPP_ACCESS_TOKEN_KEY.test(envAccessTokenVariable('3ab0fc4a-eadb-50b8-bc4d-5673ada1519e')!)).toBe(true)
    for (const name of ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_ACCESS_TOKEN_NEXUS', 'WHATSAPP_ACCESS_TOKEN_3ab0fc4aeadb50b8bc4d5673ada1519e']) {
      expect(WHATSAPP_ACCESS_TOKEN_KEY.test(name)).toBe(false)
    }
  })
})
