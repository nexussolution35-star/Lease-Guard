import { describe, expect, it } from 'vitest'

import type { OnboardingStep } from '../types/index.js'
import { hasCompanyDetails, onboardingChecklist, REQUIRED_ONBOARDING_STEPS } from './onboarding.js'

const details = {
  name: 'Nexus Solution (Pty) Ltd',
  contactEmail: 'info@nexussolution.co.za',
  contactPhone: '+27 11 555 0100',
  address: {
    line1: '12 Rivonia Road',
    suburb: 'Sandton',
    city: 'Johannesburg',
    province: 'Gauteng',
    postalCode: '2196',
    country: 'South Africa',
  },
} as const

const allDone: Record<OnboardingStep, boolean> = {
  companyDetails: true,
  whatsappConfigured: true,
  whatsappConnected: true,
  teamInvited: true,
  propertyAdded: true,
  leaseVerified: true,
  statementUploaded: true,
}

describe('hasCompanyDetails', () => {
  it('accepts a company whose required profile fields are filled in', () => {
    expect(hasCompanyDetails(details)).toBe(true)
  })

  it('rejects blank required fields', () => {
    expect(hasCompanyDetails({ ...details, contactPhone: '  ' })).toBe(false)
    expect(hasCompanyDetails({ ...details, contactEmail: '' })).toBe(false)
    expect(hasCompanyDetails({ ...details, address: { ...details.address, line1: '' } })).toBe(false)
    expect(hasCompanyDetails({ ...details, address: { ...details.address, city: ' ' } })).toBe(false)
  })
})

describe('onboardingChecklist', () => {
  it('is complete when every step is done', () => {
    expect(onboardingChecklist('c1', allDone)).toEqual({ companyId: 'c1', ...allDone, complete: true })
  })

  it('requires everything except inviting a team', () => {
    expect([...REQUIRED_ONBOARDING_STEPS].sort()).toEqual(
      ['companyDetails', 'leaseVerified', 'propertyAdded', 'statementUploaded', 'whatsappConfigured', 'whatsappConnected'].sort(),
    )
    expect(onboardingChecklist('c1', { ...allDone, whatsappConnected: false }).complete).toBe(false)
  })

  it('is incomplete while any required step is open', () => {
    for (const step of REQUIRED_ONBOARDING_STEPS) {
      expect(onboardingChecklist('c1', { ...allDone, [step]: false }).complete).toBe(false)
    }
  })

  it('does not require inviting a team', () => {
    expect(REQUIRED_ONBOARDING_STEPS).not.toContain('teamInvited')
    const checklist = onboardingChecklist('c1', { ...allDone, teamInvited: false })
    expect(checklist).toMatchObject({ teamInvited: false, complete: true })
  })
})
