import { describe, expect, it } from 'vitest'

import { toCompany, toCompanySummary } from './companies.mapper'
import { companyRow, whatsappRow } from './companies.test-helpers'

describe('companies mapper', () => {
  it('maps a company row and its WhatsApp account to the domain Company', () => {
    const company = toCompany(companyRow, [whatsappRow])

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
      whatsapp: { connectionStatus: 'connected', numberCount: 1, connectedNumberCount: 1 },
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

  it('reports WhatsApp as not configured when the company has no number', () => {
    expect(toCompany(companyRow, []).whatsapp).toEqual({ connectionStatus: 'not_configured', numberCount: 0, connectedNumberCount: 0 })
  })

  it('summarises several numbers: connected when any number is connected, otherwise the earliest number\'s status', () => {
    const pending = { ...whatsappRow, id: 'n1', connection_status: 'pending_verification' as const, created_at: '2026-01-01T08:00:00+00:00' }
    const disconnected = { ...whatsappRow, id: 'n2', connection_status: 'disconnected' as const, created_at: '2026-02-01T08:00:00+00:00' }
    const connected = { ...whatsappRow, id: 'n3', connection_status: 'connected' as const, created_at: '2026-03-01T08:00:00+00:00' }
    expect(toCompany(companyRow, [disconnected, pending, connected]).whatsapp).toEqual({
      connectionStatus: 'connected',
      numberCount: 3,
      connectedNumberCount: 1,
    })
    expect(toCompany(companyRow, [disconnected, pending]).whatsapp).toEqual({
      connectionStatus: 'pending_verification',
      numberCount: 2,
      connectedNumberCount: 0,
    })
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
