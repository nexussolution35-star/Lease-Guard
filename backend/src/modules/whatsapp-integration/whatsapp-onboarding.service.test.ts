import { ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'

import { fakeDb, type FakeResult, type RecordedQuery } from '../../common/testing/fake-db.test-helpers'
import { EmbeddedSignupExchangeError } from '../../infrastructure/whatsapp/embedded-signup-code-exchange'
import { WhatsAppOnboardingService, type CodeExchanger } from './whatsapp-onboarding.service'

const COMPANY = '6f1d2c1e-0000-4000-8000-000000000001'
const SESSION = '7a1d2c1e-0000-4000-8000-000000000009'
const STATE = 'b'.repeat(64)
const TOKEN = 'EAAG-business-token-0123456789'
const SETTINGS = { WHATSAPP_APP_ID: '1234567890', WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID: '987654321', WHATSAPP_APP_SECRET: 'secret', WHATSAPP_GRAPH_API_VERSION: 'v27.0' }

function exchanger(result: { accessToken: string } | Error): CodeExchanger & { codes: string[] } {
  const codes: string[] = []
  return {
    codes,
    exchange(code) {
      codes.push(code)
      return result instanceof Error ? Promise.reject(result) : Promise.resolve(result)
    },
  }
}

/** Answers each database function by name. */
function db(answers: Record<string, FakeResult>) {
  return fakeDb((query: RecordedQuery) => answers[query.table] ?? { data: null, error: { code: 'XX000', message: `unexpected ${query.table}` } })
}
const argsOf = (queries: RecordedQuery[], fn: string) => queries.find((q) => q.table === `rpc:${fn}`)?.calls[0][1][0]

/** Records which numbers the service asked to verify after a signup. */
const verified: string[] = []
function verifier(queued = true) {
  return {
    verifyAfterSignup: async (_db: unknown, _companyId: string, phoneNumberId: string) => {
      verified.push(phoneNumberId)
      return queued
    },
  }
}

const finish = { state: STATE, event: 'FINISH' as const, code: 'AQD-code', sessionInfo: { messaging_account_ids: ['5241'], phone_number_id: '1065', business_id: '2729' } }

describe('WhatsAppOnboardingService.start', () => {
  it('starts a session and hands the browser what FB.login needs, Embedded Signup v5', async () => {
    const { client, queries } = db({
      'rpc:start_whatsapp_onboarding': { data: [{ session_id: SESSION, state: STATE, expires_at: '2026-11-10T10:15:00+00:00' }], error: null },
    })
    const started = await new WhatsAppOnboardingService(SETTINGS, exchanger({ accessToken: TOKEN }), verifier()).start(client, COMPANY)
    expect(started).toEqual({
      sessionId: SESSION,
      state: STATE,
      expiresAt: '2026-11-10T10:15:00+00:00',
      appId: '1234567890',
      configId: '987654321',
      graphApiVersion: 'v27.0',
      extras: { version: 'v5' },
    })
    expect(argsOf(queries, 'start_whatsapp_onboarding')).toEqual({ p_company_id: COMPANY })
  })

  it('refuses to start while Embedded Signup is not configured', async () => {
    const { client, queries } = db({})
    await expect(new WhatsAppOnboardingService({ WHATSAPP_GRAPH_API_VERSION: 'v27.0' }, null, verifier()).start(client, COMPANY)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    )
    expect(queries).toEqual([])
  })
})

describe('WhatsAppOnboardingService.complete', () => {
  it('claims the session, exchanges the code once and stores the token through the database, never returning it', async () => {
    const exchange = exchanger({ accessToken: TOKEN })
    const { client, queries } = db({
      'rpc:record_whatsapp_onboarding_result': { data: 'recorded', error: null },
      'rpc:store_whatsapp_onboarding_token': { data: [{ business_account_id: '5241', phone_number_id: '1065' }], error: null },
    })
    const result = await new WhatsAppOnboardingService(SETTINGS, exchange, verifier()).complete(client, COMPANY, SESSION, finish)

    expect(result).toEqual({
      sessionId: SESSION,
      status: 'exchanged',
      businessAccountIds: ['5241'],
      phoneNumberIds: ['1065'],
      message: expect.stringMatching(/pending verification/),
    })
    expect(JSON.stringify(result)).not.toContain(TOKEN)
    expect(exchange.codes).toEqual(['AQD-code'])
    expect(queries.map((q) => q.table)).toEqual(['rpc:record_whatsapp_onboarding_result', 'rpc:store_whatsapp_onboarding_token'])
    expect(argsOf(queries, 'record_whatsapp_onboarding_result')).toMatchObject({
      p_company_id: COMPANY,
      p_session_id: SESSION,
      p_state: STATE,
      p_status: 'code_received',
      p_event: 'FINISH',
      p_embedded_signup_version: 'v5',
      p_messaging_account_ids: ['5241'],
      p_phone_number_id: '1065',
      p_business_portfolio_id: '2729',
    })
    expect(JSON.stringify(argsOf(queries, 'record_whatsapp_onboarding_result'))).not.toContain('AQD-code')
    expect(argsOf(queries, 'store_whatsapp_onboarding_token')).toEqual({ p_company_id: COMPANY, p_session_id: SESSION, p_access_token: TOKEN })
  })

  it('starts verifying the stored number, and tells the admin when that could not be queued yet', async () => {
    const answers = {
      'rpc:record_whatsapp_onboarding_result': { data: 'recorded', error: null },
      'rpc:store_whatsapp_onboarding_token': { data: [{ business_account_id: '5241', phone_number_id: '1065' }], error: null },
    }
    verified.length = 0
    const ok = await new WhatsAppOnboardingService(SETTINGS, exchanger({ accessToken: TOKEN }), verifier()).complete(db(answers).client, COMPANY, SESSION, finish)
    expect(verified).toEqual(['1065'])
    expect(ok.message).toContain('checking it with Meta now')
    const later = await new WhatsAppOnboardingService(SETTINGS, exchanger({ accessToken: TOKEN }), verifier(false)).complete(db(answers).client, COMPANY, SESSION, finish)
    expect(later).toMatchObject({ status: 'exchanged', message: expect.stringContaining('click Verify again') })
  })

  it('records a cancel with recovery steps and exchanges nothing', async () => {
    const exchange = exchanger({ accessToken: TOKEN })
    const { client, queries } = db({ 'rpc:record_whatsapp_onboarding_result': { data: 'recorded', error: null } })
    const result = await new WhatsAppOnboardingService(SETTINGS, exchange, verifier()).complete(client, COMPANY, SESSION, {
      state: STATE,
      event: 'CANCEL',
      sessionInfo: { current_step: 'PHONE_NUMBER_SETUP' },
    })
    expect(result).toMatchObject({ status: 'cancelled', businessAccountIds: [], phoneNumberIds: [] })
    expect(result.message).toMatch(/Connect WhatsApp Business/)
    expect(exchange.codes).toEqual([])
    expect(argsOf(queries, 'record_whatsapp_onboarding_result')).toMatchObject({ p_status: 'cancelled', p_current_step: 'PHONE_NUMBER_SETUP', p_error_message: result.message })
  })

  it('records a finish without a code as failed, with what to do', async () => {
    const { client, queries } = db({ 'rpc:record_whatsapp_onboarding_result': { data: 'recorded', error: null } })
    const result = await new WhatsAppOnboardingService(SETTINGS, exchanger({ accessToken: TOKEN }), verifier()).complete(client, COMPANY, SESSION, {
      ...finish,
      code: undefined,
    })
    expect(result.status).toBe('failed')
    expect(result.message).toMatch(/click Finish/)
    expect(argsOf(queries, 'record_whatsapp_onboarding_result')).toMatchObject({ p_status: 'failed' })
  })

  it('records a code Meta refused as a failed exchange; nothing is stored', async () => {
    const { client, queries } = db({
      'rpc:record_whatsapp_onboarding_result': { data: 'recorded', error: null },
      'rpc:fail_whatsapp_onboarding_exchange': { data: 'recorded', error: null },
    })
    const result = await new WhatsAppOnboardingService(SETTINGS, exchanger(new EmbeddedSignupExchangeError('code_rejected', { status: 400, graphCode: 100 })), verifier()).complete(
      client,
      COMPANY,
      SESSION,
      finish,
    )
    expect(result).toMatchObject({ status: 'failed', businessAccountIds: [], phoneNumberIds: [] })
    expect(result.message).toMatch(/30 seconds/)
    expect(queries.map((q) => q.table)).toEqual(['rpc:record_whatsapp_onboarding_result', 'rpc:fail_whatsapp_onboarding_exchange'])
    expect(argsOf(queries, 'fail_whatsapp_onboarding_exchange')).toEqual({ p_company_id: COMPANY, p_session_id: SESSION, p_error_message: result.message })
  })

  it.each([
    ['not_found', NotFoundException],
    ['already_used', ConflictException],
    ['expired', ConflictException],
  ] as const)('answers a session that is %s with an error and never exchanges its code', async (outcome, type) => {
    const exchange = exchanger({ accessToken: TOKEN })
    const { client } = db({ 'rpc:record_whatsapp_onboarding_result': { data: outcome, error: null } })
    await expect(new WhatsAppOnboardingService(SETTINGS, exchange, verifier()).complete(client, COMPANY, SESSION, finish)).rejects.toBeInstanceOf(type)
    expect(exchange.codes).toEqual([])
  })

  it('tells the admin that an expired or superseded signup must be started again, not that it was completed', async () => {
    const { client } = db({ 'rpc:record_whatsapp_onboarding_result': { data: 'expired', error: null } })
    const error: unknown = await new WhatsAppOnboardingService(SETTINGS, exchanger({ accessToken: TOKEN }), verifier())
      .complete(client, COMPANY, SESSION, finish)
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ConflictException)
    const message = (error as ConflictException).message
    expect(message).toMatch(/newer one was started/)
    expect(message).toMatch(/Click Connect WhatsApp Business to start again/)
    expect(message).not.toMatch(/already completed/)
  })
})
