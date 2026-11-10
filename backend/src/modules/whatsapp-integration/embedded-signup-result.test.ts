import { describe, expect, it } from 'vitest'

import { type EmbeddedSignupResult, interpretEmbeddedSignupResult } from './embedded-signup-result'
import { completeOnboardingBodySchema } from './whatsapp-onboarding.schemas'

const STATE = 'a'.repeat(64)
const parse = (body: unknown) => completeOnboardingBodySchema.parse(body)
/** The admin's message of a result that ends the session. */
const messageOf = (result: EmbeddedSignupResult) => (result.status === 'code_received' ? undefined : result.errorMessage)

describe('interpretEmbeddedSignupResult', () => {
  it('takes the messaging account ids of an Embedded Signup v5 finish, and exchanges its code', () => {
    const result = interpretEmbeddedSignupResult(
      parse({
        state: STATE,
        event: 'FINISH',
        code: 'AQD-code',
        sessionInfo: {
          phone_number_id: '106540352242922',
          messaging_account_ids: ['524126980791429'],
          business_id: '2729063490586005',
          is_on_biz_app: false,
          primary_waac_ids: [],
          page_ids: [],
        },
      }),
    )
    expect(result).toEqual({
      status: 'code_received',
      code: 'AQD-code',
      record: {
        event: 'FINISH',
        embeddedSignupVersion: 'v5',
        businessPortfolioId: '2729063490586005',
        messagingAccountIds: ['524126980791429'],
        phoneNumberId: '106540352242922',
        isOnBusinessApp: false,
      },
    })
  })

  it('falls back to the v4 waba_id', () => {
    const result = interpretEmbeddedSignupResult(
      parse({ state: STATE, event: 'FINISH', code: 'AQD-code', sessionInfo: { phone_number_id: '1065', waba_id: '5241', business_id: '2729' } }),
    )
    expect(result).toMatchObject({ status: 'code_received', record: { embeddedSignupVersion: 'v4', messagingAccountIds: ['5241'], phoneNumberId: '1065' } })
  })

  it('records a cancel with the step the admin left at, and how to recover', () => {
    const result = interpretEmbeddedSignupResult(parse({ state: STATE, event: 'CANCEL', sessionInfo: { current_step: 'PHONE_NUMBER_SETUP' } }))
    expect(result.status).toBe('cancelled')
    expect(result.record).toMatchObject({ event: 'CANCEL', currentStep: 'PHONE_NUMBER_SETUP' })
    expect(messageOf(result)).toMatch(/closed Meta.s signup/i)
    expect(messageOf(result)).toMatch(/Connect WhatsApp Business/)
  })

  it("records Meta's error code and message and explains it", () => {
    const result = interpretEmbeddedSignupResult(
      parse({
        state: STATE,
        event: 'ERROR',
        sessionInfo: { error_message: 'Phone number already registered', error_code: 524126, session_id: 'f34b', timestamp: '1689211' },
      }),
    )
    expect(result.status).toBe('failed')
    expect(result.record).toMatchObject({ metaErrorCode: '524126', metaErrorMessage: 'Phone number already registered', metaSessionId: 'f34b' })
    expect(messageOf(result)).toContain('524126')
  })

  it('fails a finish without a code, explaining that Finish must be clicked', () => {
    const result = interpretEmbeddedSignupResult(parse({ state: STATE, event: 'FINISH', sessionInfo: { messaging_account_ids: ['5241'] } }))
    expect(result.status).toBe('failed')
    expect(result.record.messagingAccountIds).toEqual(['5241'])
    expect(messageOf(result)).toMatch(/without an authorisation code/)
    expect(messageOf(result)).toMatch(/click Finish/)
  })

  it('does not exchange a code when Meta did not say which account was shared', () => {
    const result = interpretEmbeddedSignupResult(parse({ state: STATE, event: 'FINISH', code: 'AQD-code' }))
    expect(result.status).toBe('failed')
    expect(result).not.toHaveProperty('code')
    expect(messageOf(result)).toMatch(/did not say which WhatsApp Business Account/)
  })
})

describe('completeOnboardingBodySchema', () => {
  it('refuses unknown top-level fields, malformed ids, a malformed state and unknown events', () => {
    expect(() => parse({ state: STATE, event: 'FINISH', accessToken: 'x' })).toThrow()
    expect(() => parse({ state: STATE, event: 'FINISH', sessionInfo: { waba_id: 'abc' } })).toThrow()
    expect(() => parse({ state: 'short', event: 'CANCEL' })).toThrow()
    expect(() => parse({ state: STATE, event: 'DONE' })).toThrow()
    expect(() => parse({ state: STATE, event: 'FINISH', code: 'has space' })).toThrow()
  })
})
