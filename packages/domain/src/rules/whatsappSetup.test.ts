import { describe, expect, it } from 'vitest'

import { WHATSAPP_SETUP_STATES, WHATSAPP_SETUP_STEPS, type WhatsAppSetupState, type WhatsAppSetupStep } from '../types/index.js'
import { isWhatsAppTestRecipient, whatsAppSetup, type WhatsAppSetupRow } from './whatsappSetup.js'

const REQUIRED = new Set<WhatsAppSetupStep>(['business_profile', 'meta_account', 'business_account', 'phone_number', 'webhook', 'message_templates', 'test_message', 'ready_for_activation'])

function rows(states: Partial<Record<WhatsAppSetupStep, WhatsAppSetupState>>): WhatsAppSetupRow[] {
  return WHATSAPP_SETUP_STEPS.map((step) => ({ step, required: REQUIRED.has(step), state: states[step] ?? 'action_needed' }))
}

describe('whatsAppSetup', () => {
  it('keeps the ten steps in order whatever order the facts arrive in', () => {
    const setup = whatsAppSetup([...rows({})].reverse(), { active: false })
    expect(setup.steps.map((s) => s.step)).toEqual([...WHATSAPP_SETUP_STEPS])
    expect(setup.totalSteps).toBe(10)
  })

  it('counts the steps done and is ready only when the database says the activation step is done', () => {
    const almost = whatsAppSetup(rows({ business_profile: 'done', meta_account: 'done', ai_agent: 'done', ready_for_activation: 'blocked' }), { active: false })
    expect(almost.completedSteps).toBe(3)
    expect(almost.readyForActivation).toBe(false)

    const ready = whatsAppSetup(
      WHATSAPP_SETUP_STEPS.map((step) => ({ step, required: REQUIRED.has(step), state: 'done' as const })),
      { active: true, activatedAt: '2026-11-11T08:00:00.000Z' },
    )
    expect(ready.completedSteps).toBe(10)
    expect(ready.readyForActivation).toBe(true)
    expect(ready.activation.active).toBe(true)
  })

  it('tells the admin what to do next for every step and state', () => {
    for (const step of WHATSAPP_SETUP_STEPS) {
      for (const state of WHATSAPP_SETUP_STATES) {
        const [status] = whatsAppSetup([{ step, required: REQUIRED.has(step), state }], { active: false }).steps
        expect(status?.title, `${step} title`).not.toBe('')
        expect(status?.guidance, `${step} ${state}`).not.toBe('')
      }
    }
  })

  it('says what the test message waits for and that only delivery counts', () => {
    const steps = whatsAppSetup(rows({ test_message: 'waiting_on_meta' }), { active: false }).steps
    expect(steps.find((s) => s.step === 'test_message')?.guidance).toMatch(/delivered/i)
  })

  it('explains that a blocked step waits for an earlier one', () => {
    const steps = whatsAppSetup(rows({ phone_number: 'blocked' }), { active: false }).steps
    expect(steps.find((s) => s.step === 'phone_number')?.guidance).toMatch(/first/i)
  })

  it('throws on a step it does not know rather than showing it as done', () => {
    expect(() => whatsAppSetup([{ step: 'mystery' as WhatsAppSetupStep, required: true, state: 'done' }], { active: false })).toThrow(/mystery/)
  })
})

describe('isWhatsAppTestRecipient', () => {
  it('accepts an international number and refuses a local or malformed one', () => {
    expect(isWhatsAppTestRecipient('+27821234567')).toBe(true)
    expect(isWhatsAppTestRecipient('0821234567')).toBe(false)
    expect(isWhatsAppTestRecipient('+27 82 123 4567')).toBe(false)
    expect(isWhatsAppTestRecipient('+0821234567')).toBe(false)
  })
})
