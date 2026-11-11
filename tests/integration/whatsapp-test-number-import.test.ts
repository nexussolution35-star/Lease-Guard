import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import path from 'node:path'

import { unwrap } from '@leaseguard/api-client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { FakeAgentLlm } from '../../backend/src/messaging/agent.test-helpers.ts'
import { freePort } from '../fixtures/api-server.ts'
import { localSql } from '../fixtures/local-db.ts'
import { BACKEND_ROOT, REPO_ROOT, TEST_OUTPUT_ROOT } from '../fixtures/paths.ts'
import { deleteKeysWithPrefix, RedisConnection } from '../fixtures/redis.ts'
import { apiAs, check, expectOk, integration, serviceRole, world } from './support/clients.ts'
import { FakeMetaGraph, type FakeBusiness } from './support/fake-meta-graph.ts'
import { type InProcessWorker, startInProcessWorker } from './support/in-process-worker.ts'

/**
 * The number import (ticket 15) end to end on the local stack: the operator command `whatsapp:import-test-number`
 * (this run's build, `backend/.dev-integration/operator/import-whatsapp-test-number.js`, with an explicit local
 * environment, so the root `.env` is never read) connects "the installation's test number" to the world's company A.
 * The worker's real number verification runs in this process on the command's queue prefix against the fake Graph
 * API (support/fake-meta-graph.ts), so the number becomes connected only after LeaseGuard verified it. Nothing calls
 * Meta. Asserted: dry run by default, confirmation (--yes without a terminal), the token only in Vault for company A
 * and never printed or queued, refusals (unknown company, a number another company holds), safe re-runs and a newer
 * token replacing the stored one.
 */

const unique = `${Date.now()}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`
const META = { appId: '626262626262', appSecret: 'import-test-app-secret-not-a-real-one', graphVersion: 'v27.0' }
const ACCOUNT_ID = `${unique}31`
const PHONE_ID = `${unique}32`
const OTHER_PHONE_ID = `${unique}33`
const TOKEN = `EAAG-it-test-number-${unique}`
const NEWER_TOKEN = `EAAG-it-test-number-newer-${unique}`
const number = (token: string): FakeBusiness => ({
  code: `unused-${token}`,
  token,
  businessAccountId: ACCOUNT_ID,
  phoneNumberId: PHONE_ID,
  displayPhoneNumber: '+27 11 555 0177',
  verifiedName: 'Nexus Solution Test',
  templateId: `${unique}34`,
})

const COMMAND = path.join(BACKEND_ROOT, '.dev-integration', 'operator', 'import-whatsapp-test-number.js')
const WORKER_LOG = path.join(TEST_OUTPUT_ROOT, 'integration', 'worker-test-number-import.log')

let graph: FakeMetaGraph
let worker: InProcessWorker | undefined
let redis: RedisConnection
let queuePrefix: string

const companyA = () => world().companies.a.id
const companyB = () => world().companies.b.id

/** Runs the operator command without a terminal and with ONLY its own settings (the root .env is never read). */
function importCommand(args: string[], settings: { token?: string; phoneNumberId?: string } = {}): Promise<{ code: number; output: string }> {
  const ctx = integration()
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [COMMAND, ...args], {
      cwd: REPO_ROOT,
      env: {
        PATH: process.env.PATH ?? '',
        SUPABASE_URL: ctx.supabaseUrl,
        SUPABASE_SERVICE_ROLE_KEY: ctx.serviceRoleKey,
        REDIS_URL: ctx.redisUrl,
        QUEUE_PREFIX: queuePrefix,
        WHATSAPP_ACCESS_TOKEN: settings.token ?? TOKEN,
        WHATSAPP_PHONE_NUMBER_ID: settings.phoneNumberId ?? PHONE_ID,
        WHATSAPP_BUSINESS_MESSAGING_ACCOUNT_ID: ACCOUNT_ID,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()))
    child.on('error', reject)
    child.on('exit', (code) => resolve({ code: code ?? 1, output }))
  })
}

async function waitFor<T>(what: string, probe: () => Promise<T | null | undefined | false>, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await probe()
    if (value) return value
    if (Date.now() > deadline) throw new Error(`Timed out waiting for: ${what} (see ${WORKER_LOG})`)
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
}

async function numbersOf(companyId: string, phoneNumberId = PHONE_ID) {
  return check(
    await serviceRole()
      .from('whatsapp_phone_numbers')
      .select('id, business_account_id, connection_status, operator_imported_at, access_token_reference')
      .eq('company_id', companyId)
      .eq('phone_number_id', phoneNumberId),
    'Read the numbers',
  ) as { id: string; business_account_id: string; connection_status: string; operator_imported_at: string | null; access_token_reference: string }[]
}

async function accountsOf(companyId: string) {
  return check(
    await serviceRole().from('whatsapp_business_accounts').select('id, access_token_reference').eq('company_id', companyId).eq('business_account_id', ACCOUNT_ID),
    'Read the accounts',
  ) as { id: string; access_token_reference: string | null }[]
}

/** The secrets the import stored for a company (Vault is not exposed through PostgREST). */
async function importSecrets(companyId: string): Promise<number> {
  const rows = (await localSql(`select count(*)::int as n from vault.secrets where name like 'whatsapp_access_token:${companyId}:import:%'`)) as { n: number }[]
  return rows[0]?.n ?? 0
}

/** The token the worker reads for the number (service role only). */
async function storedToken(numberId: string): Promise<unknown> {
  return (await serviceRole().rpc('whatsapp_account_access_token', { p_account_id: numberId })).data
}

const jobKey = (numberId: string) => `${queuePrefix}:whatsapp-number-verification:whatsapp-number-verification.${companyA()}.${numberId}`

async function connected(): Promise<string> {
  return waitFor('the imported number connected', async () => {
    const [row] = await numbersOf(companyA())
    return row?.connection_status === 'connected' ? row.id : null
  })
}

beforeAll(async () => {
  const ctx = integration()
  queuePrefix = `${ctx.queuePrefix}-import`
  redis = await RedisConnection.open(ctx.redisUrl)
  // Two grants of the same test number: the token configured first, and the newer one that later replaces it.
  graph = await FakeMetaGraph.start(META, { current: number(TOKEN), newer: number(NEWER_TOKEN) }, await freePort())
  worker = startInProcessWorker({
    supabaseUrl: ctx.supabaseUrl,
    serviceRoleKey: ctx.serviceRoleKey,
    redisUrl: ctx.redisUrl,
    queuePrefix,
    meta: { ...META, graphUrl: graph.url },
    llm: new FakeAgentLlm(() => ({ action: 'ignore', category: 'other', confidence: 1 })),
    logFile: WORKER_LOG,
  })
})

afterAll(async () => {
  await worker?.stop()
  await graph?.close()
  redis?.close()
  const db = serviceRole()
  for (const companyId of [companyA(), companyB()]) {
    expectOk(await db.from('whatsapp_phone_numbers').delete().eq('company_id', companyId).in('phone_number_id', [PHONE_ID, OTHER_PHONE_ID]), 'Delete the numbers')
    expectOk(await db.from('whatsapp_business_accounts').delete().eq('company_id', companyId).eq('business_account_id', ACCOUNT_ID), 'Delete the accounts')
    await localSql(`delete from vault.secrets where name like 'whatsapp_access_token:${companyId}:import:%'`)
  }
  if (queuePrefix) await deleteKeysWithPrefix(integration().redisUrl, queuePrefix)
  expect(await importSecrets(companyA())).toBe(0)
}, 60_000)

describe('Number import: Nexus Solution connects its own test number', () => {
  it('is a dry run by default: shows the company and the number, and changes nothing', async () => {
    const { code, output } = await importCommand(['--company', companyA()])
    expect(code, output).toBe(0)
    expect(output).toContain(`Company:      ${world().companies.a.name}`)
    expect(output).toContain(`Number:       phone number id ${PHONE_ID} in WhatsApp Business Account ${ACCOUNT_ID}`)
    expect(output).toContain('Dry run: nothing was changed.')
    expect(output).not.toContain(TOKEN)
    expect(await numbersOf(companyA())).toEqual([])
    expect(await accountsOf(companyA())).toEqual([])
    expect(await importSecrets(companyA())).toBe(0)
  })

  it('applies only with --yes when there is no terminal to confirm on', async () => {
    const { code, output } = await importCommand(['--company', companyA(), '--apply'])
    expect(code).toBe(1)
    expect(output).toContain('--apply --yes')
    expect(await numbersOf(companyA())).toEqual([])
    expect(await importSecrets(companyA())).toBe(0)
  })

  it('refuses a company that does not exist', async () => {
    const { code, output } = await importCommand(['--company', randomUUID(), '--apply', '--yes'])
    expect(code).toBe(1)
    expect(output).toMatch(/No company matches/)
  })

  it('refuses a number another company has connected, and names it', async () => {
    expectOk(
      await serviceRole().from('whatsapp_phone_numbers').insert({
        company_id: companyB(),
        business_account_id: `${unique}39`,
        phone_number_id: OTHER_PHONE_ID,
        display_name: 'B number',
        display_number: '+27 12 555 0199',
        access_token_reference: `secret://env/WHATSAPP_ACCESS_TOKEN_${companyB().replaceAll('-', '').toUpperCase()}`,
        connection_status: 'connected',
        last_verified_at: new Date().toISOString(),
      }),
      'Connect a number in company B',
    )
    const { code, output } = await importCommand(['--company', companyA(), '--apply', '--yes'], { phoneNumberId: OTHER_PHONE_ID })
    expect(code).toBe(1)
    expect(output).toContain(`belongs to another company: ${world().companies.b.name} (${companyB()})`)
    expect(await numbersOf(companyA(), OTHER_PHONE_ID)).toEqual([])
    expect(await importSecrets(companyA())).toBe(0)
  })

  it('stores the token in Vault for the company only and connects the number only after verification', async () => {
    const { code, output } = await importCommand(['--company', companyA(), '--apply', '--yes'])
    expect(code, output).toBe(0)
    expect(output).not.toContain(TOKEN)
    const numberId = /^Number id:\s+([0-9a-f-]{36})$/m.exec(output)?.[1]
    expect(numberId, output).toBeDefined()

    const [row] = await numbersOf(companyA())
    expect(row).toMatchObject({ id: numberId, business_account_id: ACCOUNT_ID })
    expect(row?.access_token_reference).toMatch(/^secret:\/\/vault\//)
    expect(row?.operator_imported_at).not.toBeNull()
    expect(await importSecrets(companyA())).toBe(1)
    expect(await importSecrets(companyB())).toBe(0)
    expect(await storedToken(numberId!)).toBe(TOKEN)
    expect((await accountsOf(companyA()))[0]?.access_token_reference).toBe(row?.access_token_reference)

    // The same verification as Embedded Signup, on ids only: the token never reaches Redis.
    expect(JSON.parse(String(await redis.command('HGET', jobKey(numberId!), 'data')))).toEqual({ companyId: companyA(), numberId })
    expect(await connected()).toBe(numberId)
    const inspected = graph.requests.filter((r) => r.path === '/debug_token').map((r) => r.query.input_token)
    expect(inspected).toEqual([TOKEN])
    expect(graph.requests.some((r) => r.method === 'POST' && r.path === `/${ACCOUNT_ID}/subscribed_apps` && r.token === TOKEN)).toBe(true)

    // The integration page shows the real status, each verified step, and that Nexus imported it.
    const accounts = await unwrap(apiAs('admin', 'a').GET('/api/v1/integrations/whatsapp/business-accounts'))
    const listed = accounts.flatMap((a) => a.numbers).find((n) => n.id === numberId)
    expect(listed).toMatchObject({ connectionStatus: 'connected', verifiedName: 'Nexus Solution Test', operatorImportedAt: expect.any(String) })
    expect(listed?.verificationSteps.map((s) => s.status)).toEqual(['passed', 'passed', 'passed', 'passed', 'passed'])
    // Another company's members never see it.
    const other = await unwrap(apiAs('manager', 'b').GET('/api/v1/integrations/whatsapp/business-accounts'))
    expect(other.flatMap((a) => a.numbers).map((n) => n.phoneNumberId)).not.toContain(PHONE_ID)
  })

  it('is safe to re-run: a connected number with the same token is left alone, nothing is duplicated', async () => {
    const before = graph.requests.length
    const { code, output } = await importCommand(['--company', companyA(), '--apply', '--yes'])
    expect(code, output).toBe(0)
    expect(output).toMatch(/already connected/)
    expect((await numbersOf(companyA())).map((n) => n.connection_status)).toEqual(['connected'])
    expect(await accountsOf(companyA())).toHaveLength(1)
    expect(await importSecrets(companyA())).toBe(1)
    expect(graph.requests.length).toBe(before)
  })

  it('replaces the stored token with a newer one and verifies the number again with it', async () => {
    const [previous] = await numbersOf(companyA())
    const { code, output } = await importCommand(['--company', companyA(), '--apply', '--yes'], { token: NEWER_TOKEN })
    expect(code, output).toBe(0)
    expect(output).toMatch(/replacing its current credential/)
    expect(output).toMatch(/1 earlier token deleted/)
    expect(output).not.toContain(NEWER_TOKEN)

    const [row] = await numbersOf(companyA())
    expect(row?.id).toBe(previous?.id)
    expect(row?.access_token_reference).not.toBe(previous?.access_token_reference)
    expect(await importSecrets(companyA())).toBe(1)
    expect(await storedToken(row!.id)).toBe(NEWER_TOKEN)
    expect(await accountsOf(companyA())).toHaveLength(1)
    await waitFor('the number verified with the newer token', async () => graph.requests.some((r) => r.path === '/debug_token' && r.query.input_token === NEWER_TOKEN))
    expect(await connected()).toBe(row?.id)
  })
})
