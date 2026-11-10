import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import path from 'node:path'

import { createApiClient, unwrap, type ApiClient, type CompleteWhatsAppOnboardingDto } from '@leaseguard/api-client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { apiEnvironment, freePort, startApi, type ApiBuild, type RunningApi } from '../fixtures/api-server.ts'
import { localSql } from '../fixtures/local-db.ts'
import { RedisConnection } from '../fixtures/redis.ts'
import { TEST_OUTPUT_ROOT } from '../fixtures/paths.ts'
import { apiAs, apiErrorOf, check, expectOk, integration, serviceRole, world } from './support/clients.ts'

/**
 * Meta Embedded Signup against the real API and database: a second API process of this run's build is
 * configured with a test Meta app whose Graph API is a local fake server (never Meta). The code is
 * exchanged once, the business token lands in Vault for that company only and is never returned or
 * logged, and sessions are single-use, expiring and limited to the admin and company that started them.
 */

const APP_ID = '424242424242'
const CONFIG_ID = '535353535353'
const APP_SECRET = 'it-app-secret-not-a-real-one'
const unique = `${Date.now()}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`
const metaId = (n: number) => `${unique}${n}`
const TOKEN = `EAAG-it-business-token-${unique}`
const GOOD_CODE = `AQD-good-${unique}`
const EXPIRED_CODE = `AQD-expired-${unique}`

/** The API process with Meta configured; its own log so the suite's api.log is untouched. */
const BUILD: ApiBuild = { dirName: '.dev-integration', logFile: path.join(TEST_OUTPUT_ROOT, 'integration', 'api-embedded-signup.log') }

let graph: Server
const graphRequests: URL[] = []
let api: RunningApi

function configuredApiAs(user: 'admin' | 'manager' | 'readOnly', company: 'a' | 'b'): ApiClient {
  const ctx = integration()
  return createApiClient({
    baseUrl: api.baseUrl,
    getAccessToken: () => ctx.accessTokens[user],
    getCompanyId: () => world().companies[company].id,
  })
}

async function start(user: 'admin' | 'manager' | 'readOnly' = 'admin', company: 'a' | 'b' = 'a') {
  return unwrap(configuredApiAs(user, company).POST('/api/v1/integrations/whatsapp/onboarding-sessions'))
}

/** The request body; sessionInfo is what Meta's message carried (numbers where Meta sends numbers). */
type CompleteBody = Omit<CompleteWhatsAppOnboardingDto, 'sessionInfo'> & { sessionInfo?: Record<string, unknown> }

function complete(sessionId: string, body: CompleteBody, user: 'admin' | 'manager' = 'admin', company: 'a' | 'b' = 'a') {
  return unwrap(
    configuredApiAs(user, company).POST('/api/v1/integrations/whatsapp/onboarding-sessions/{sessionId}/complete', {
      params: { path: { sessionId } },
      body: body as never,
    }),
  )
}

async function sessionRow(id: string) {
  return check(await serviceRole().from('whatsapp_onboarding_sessions').select('*').eq('id', id).single(), 'Read the session') as {
    status: string
    error_message: string | null
    messaging_account_ids: string[]
  }
}

beforeAll(async () => {
  graph = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    graphRequests.push(url)
    res.setHeader('Content-Type', 'application/json')
    const valid =
      req.method === 'GET' &&
      url.pathname === '/v27.0/oauth/access_token' &&
      url.searchParams.get('client_id') === APP_ID &&
      url.searchParams.get('client_secret') === APP_SECRET &&
      url.searchParams.get('code') === GOOD_CODE
    if (valid) {
      res.end(JSON.stringify({ access_token: TOKEN, token_type: 'bearer' }))
    } else {
      res.statusCode = 400
      res.end(JSON.stringify({ error: { message: 'This authorization code has expired.', type: 'OAuthException', code: 100, error_subcode: 36007 } }))
    }
  })
  const graphPort = await freePort()
  await new Promise<void>((resolve) => graph.listen(graphPort, '127.0.0.1', resolve))

  const ctx = integration()
  api = await startApi(
    BUILD,
    apiEnvironment(BUILD, {
      API_PORT: String(await freePort()),
      SUPABASE_URL: ctx.supabaseUrl,
      SUPABASE_ANON_KEY: ctx.anonKey,
      REDIS_URL: ctx.redisUrl,
      QUEUE_PREFIX: ctx.queuePrefix,
      WHATSAPP_APP_ID: APP_ID,
      WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID: CONFIG_ID,
      WHATSAPP_APP_SECRET: APP_SECRET,
      WHATSAPP_GRAPH_API_URL: `http://127.0.0.1:${graphPort}`,
      WHATSAPP_GRAPH_API_VERSION: 'v27.0',
    }),
  )
}, 90_000)

afterAll(async () => {
  await api?.stop()
  await new Promise<void>((resolve) => (graph ? graph.close(() => resolve()) : resolve()))
  const db = serviceRole()
  const companyIds = [world().companies.a.id, world().companies.b.id]
  const phoneIds = Array.from({ length: 10 }, (_, i) => metaId(i))
  expectOk(await db.from('whatsapp_phone_numbers').delete().in('phone_number_id', phoneIds), 'Delete the signed-up numbers')
  expectOk(await db.from('whatsapp_business_accounts').delete().in('business_account_id', phoneIds), 'Delete the signed-up accounts')
  expectOk(await db.from('whatsapp_onboarding_sessions').delete().in('company_id', companyIds), 'Delete the sessions')
  await localSql(
    `delete from vault.secrets where ${companyIds.map((id) => `name like 'whatsapp_access_token:${id}:onboarding:%'`).join(' or ')}`,
  )
})

describe('Meta Embedded Signup', () => {
  it('offers the public app and configuration ids, never the app secret', async () => {
    const capabilities = await unwrap(configuredApiAs('readOnly', 'a').GET('/api/v1/integrations/whatsapp/capabilities'))
    expect(capabilities).toMatchObject({ embeddedSignupConfigured: true, appId: APP_ID, embeddedSignupConfigId: CONFIG_ID })
    expect(JSON.stringify(capabilities)).not.toContain(APP_SECRET)
  })

  it('connects a number: the code is exchanged once and the token is stored in Vault for the company only, never returned or logged', async () => {
    const session = await start()
    expect(session).toMatchObject({ appId: APP_ID, configId: CONFIG_ID, graphApiVersion: 'v27.0', extras: { version: 'v5' } })
    expect(session.state).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(session)).not.toContain(APP_SECRET)

    const before = graphRequests.length
    const result = await complete(session.sessionId, {
      state: session.state,
      event: 'FINISH',
      code: GOOD_CODE,
      sessionInfo: { phone_number_id: metaId(1), messaging_account_ids: [metaId(2)], business_id: metaId(3), is_on_biz_app: false, page_ids: [] },
    })
    expect(result).toMatchObject({ status: 'exchanged', businessAccountIds: [metaId(2)], phoneNumberIds: [metaId(1)] })
    expect(result.message).toMatch(/pending verification/)
    expect(JSON.stringify(result)).not.toContain(TOKEN)
    expect(graphRequests.length - before).toBe(1)

    const accounts = await unwrap(apiAs('readOnly', 'a').GET('/api/v1/integrations/whatsapp/business-accounts'))
    const account = accounts.find((a) => a.businessAccountId === metaId(2))
    expect(account?.numbers.map((n) => [n.phoneNumberId, n.connectionStatus])).toEqual([[metaId(1), 'pending_verification']])
    expect(JSON.stringify(accounts)).not.toMatch(/secret:|EAAG/)
    const other = await unwrap(apiAs('manager', 'b').GET('/api/v1/integrations/whatsapp/business-accounts'))
    expect(JSON.stringify(other)).not.toContain(metaId(2))

    const secrets = (await localSql(
      `select s.name, s.decrypted_secret from public.whatsapp_phone_numbers n
       join vault.decrypted_secrets s on n.access_token_reference = 'secret://vault/' || s.id::text
       where n.phone_number_id = '${metaId(1)}'`,
    )) as { name: string; decrypted_secret: string }[]
    expect(secrets).toEqual([{ name: `whatsapp_access_token:${world().companies.a.id}:onboarding:${session.sessionId}`, decrypted_secret: TOKEN }])
    expect((await sessionRow(session.sessionId)).status).toBe('exchanged')

    // Verification (ticket 04) was queued for the worker with the number's ids only.
    const number = check(await serviceRole().from('whatsapp_phone_numbers').select('id').eq('phone_number_id', metaId(1)).single(), 'Read the number') as { id: string }
    const redis = await RedisConnection.open(integration().redisUrl)
    try {
      const companyId = world().companies.a.id
      const job = await redis.command(
        'HGET',
        `${integration().queuePrefix}:whatsapp-number-verification:whatsapp-number-verification.${companyId}.${number.id}`,
        'data',
      )
      expect(JSON.parse(String(job))).toEqual({ companyId, numberId: number.id })
    } finally {
      redis.close()
    }

    const log = readFileSync(BUILD.logFile, 'utf8')
    expect(log).not.toContain(TOKEN)
    expect(log).not.toContain(GOOD_CODE)
    expect(log).not.toContain(APP_SECRET)

    // Single-use: the same session cannot be completed again, so the code is never exchanged twice.
    const again = await apiErrorOf(complete(session.sessionId, { state: session.state, event: 'FINISH', code: GOOD_CODE, sessionInfo: { waba_id: metaId(2) } }))
    expect(again.status).toBe(409)
    expect(graphRequests.length - before).toBe(1)
  })

  it('accepts the Embedded Signup v4 shape (waba_id)', async () => {
    const session = await start()
    const result = await complete(session.sessionId, {
      state: session.state,
      event: 'FINISH',
      code: GOOD_CODE,
      sessionInfo: { phone_number_id: metaId(4), waba_id: metaId(5), business_id: metaId(3) },
    })
    expect(result).toMatchObject({ status: 'exchanged', businessAccountIds: [metaId(5)], phoneNumberIds: [metaId(4)] })
  })

  it('records cancel, error and finish without a code with how to recover, and stores nothing', async () => {
    const cancelled = await start()
    const cancel = await complete(cancelled.sessionId, { state: cancelled.state, event: 'CANCEL', sessionInfo: { current_step: 'PHONE_NUMBER_SETUP' } })
    expect(cancel.status).toBe('cancelled')
    expect(cancel.message).toMatch(/Connect WhatsApp Business/)
    expect(await sessionRow(cancelled.sessionId)).toMatchObject({ status: 'cancelled', error_message: cancel.message })

    const errored = await start()
    const error = await complete(errored.sessionId, { state: errored.state, event: 'ERROR', sessionInfo: { error_code: 524126, error_message: 'Something went wrong' } })
    expect(error).toMatchObject({ status: 'failed' })
    expect(error.message).toContain('524126')

    const noCode = await start()
    const finished = await complete(noCode.sessionId, { state: noCode.state, event: 'FINISH', sessionInfo: { messaging_account_ids: [metaId(6)] } })
    expect(finished.status).toBe('failed')
    expect(finished.message).toMatch(/click Finish/)

    const accounts = await unwrap(apiAs('admin', 'a').GET('/api/v1/integrations/whatsapp/business-accounts'))
    expect(accounts.map((a) => a.businessAccountId)).not.toContain(metaId(6))
  })

  it("records a code Meta refused and explains the 30-second lifetime; nothing is stored", async () => {
    const session = await start()
    const result = await complete(session.sessionId, {
      state: session.state,
      event: 'FINISH',
      code: EXPIRED_CODE,
      sessionInfo: { phone_number_id: metaId(7), messaging_account_ids: [metaId(8)] },
    })
    expect(result).toMatchObject({ status: 'failed', phoneNumberIds: [] })
    expect(result.message).toMatch(/30 seconds/)
    expect((await sessionRow(session.sessionId)).status).toBe('failed')
    const numbers = check(await serviceRole().from('whatsapp_phone_numbers').select('id').eq('phone_number_id', metaId(7)), 'Read numbers')
    expect(numbers).toEqual([])
  })

  it('refuses an expired session and marks it expired', async () => {
    const session = await start()
    expectOk(
      await serviceRole().from('whatsapp_onboarding_sessions').update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq('id', session.sessionId),
      'Expire the session',
    )
    const expired = await apiErrorOf(complete(session.sessionId, { state: session.state, event: 'FINISH', code: GOOD_CODE, sessionInfo: { waba_id: metaId(9) } }))
    expect(expired.status).toBe(409)
    expect(expired.message).toMatch(/expired/)
    expect((await sessionRow(session.sessionId)).status).toBe('expired')
  })

  it('lets only company admins start, and only the admin and company that started a session complete it', async () => {
    expect((await apiErrorOf(start('manager', 'a'))).status).toBe(403)
    expect((await apiErrorOf(start('readOnly', 'a'))).status).toBe(403)
    expect((await apiErrorOf(start('admin', 'b'))).status).toBe(403)

    const session = await start()
    const body = { state: session.state, event: 'CANCEL' as const }
    expect((await apiErrorOf(complete(session.sessionId, body, 'manager', 'a'))).status).toBe(403)
    expect((await apiErrorOf(complete(session.sessionId, { ...body, state: 'f'.repeat(64) }))).status).toBe(404)

    // An admin of another company (the manager, promoted in B for this check) cannot complete it either.
    // The database owner changes the role: company B has no admin to keep while the manager is demoted again.
    const membership = `company_id = '${world().companies.b.id}' and user_id = '${world().users.manager.id}'`
    await localSql(`update public.company_users set role = 'company_admin' where ${membership}`)
    try {
      expect((await apiErrorOf(complete(session.sessionId, body, 'manager', 'b'))).status).toBe(404)
    } finally {
      await localSql(`update public.company_users set role = 'property_manager' where ${membership}`)
    }
    expect((await sessionRow(session.sessionId)).status).toBe('started')
  })

  it('answers 503 where Embedded Signup is not configured', async () => {
    const error = await apiErrorOf(unwrap(apiAs('admin', 'a').POST('/api/v1/integrations/whatsapp/onboarding-sessions')))
    expect(error.status).toBe(503)
    expect(error.message).toMatch(/WHATSAPP_APP_SECRET/)
  })
})
