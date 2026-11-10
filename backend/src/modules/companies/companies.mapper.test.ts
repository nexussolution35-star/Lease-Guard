import { describe, expect, it } from 'vitest'

import { NOT_CONFIGURED_WHATSAPP, toCompany, toCompanySummary } from './companies.mapper'
import { companyRow, whatsappRow } from './companies.test-helpers'

describe('companies mapper', () => {
  it('maps a company row and its WhatsApp account to the domain Company', () => {
    const company = toCompany(companyRow, whatsappRow)

    expect(company).toEqual({
      id: companyRow.id,
      name: 'Nexus Solution (Pty) Ltd',
      tradingName: 'Nexus Solution',
      registrationNumber: '2015/123456/07',
      address: {
        line1: '12 Rivonia Road',
        suburb: 'Sandton',
        city: 'Johannesburg',
        province: 'Gauteng',
        postalCode: '2196',
        country: 'South Africa',
      },
      contactEmail: 'info@nexussolution.co.za',
      contactPhone: '+27 11 555 0100',
      status: 'active',
      initials: 'NS',
      whatsapp: {
        businessAccountId: '102938475610',
        phoneNumberId: '564738291045',
        displayName: 'Nexus Solution',
        displayNumber: '+27 11 555 0100',
        accessTokenReference: 'secret://whatsapp/cmp_nexus/access-token',
        webhookConfigured: true,
        connectionStatus: 'connected',
        lastVerifiedAt: '2026-11-01T09:00:00+00:00',
      },
      settings: {
        leaseExpiryNoticeDays: [180, 90, 30],
        renewalDeadlineWarningDays: [90, 60, 30],
        guaranteeExpiryNoticeDays: [90, 30],
        paymentReminderOffsetsDays: { initial: 3, overdue: 10, followUp: 20 },
        installmentReminderLeadDays: 3,
        ownerSummaryWeekday: 'monday',
        timezone: 'Africa/Johannesburg',
      },
      createdAt: companyRow.created_at,
      updatedAt: companyRow.updated_at,
    })
    expect(company).not.toHaveProperty('vatNumber')
    expect(company.address).not.toHaveProperty('line2')
  })

  it('reports WhatsApp as not configured when the company has no account row', () => {
    const company = toCompany(companyRow, null)
    expect(company.whatsapp).toEqual(NOT_CONFIGURED_WHATSAPP)
    expect(company.whatsapp.connectionStatus).toBe('not_configured')
  })

  it('omits the last verification time of a WhatsApp account that was never verified', () => {
    const company = toCompany(companyRow, { ...whatsappRow, last_verified_at: null, connection_status: 'pending_verification' })
    expect(company.whatsapp).not.toHaveProperty('lastVerifiedAt')
    expect(company.whatsapp.connectionStatus).toBe('pending_verification')
  })

  it('maps the workspace-switcher summary', () => {
    expect(toCompanySummary({ ...companyRow, trading_name: null })).toEqual({
      id: companyRow.id,
      name: 'Nexus Solution (Pty) Ltd',
      initials: 'NS',
      status: 'active',
    })
  })
})
