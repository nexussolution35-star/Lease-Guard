import { BadRequestException, ForbiddenException, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'

import { callsTo, fakeDb, type FakeResult, type RecordedQuery } from '../../common/testing/fake-db.test-helpers'
import { configureWhatsAppBodySchema, updateCompanyBodySchema } from './companies.schemas'
import { assertActiveCompany, CompaniesService, toCompanyPatch } from './companies.service'
import { companyRow, numberRow, whatsappRow } from './companies.test-helpers'

const USER = '6f1d2c1e-0000-4000-8000-0000000000b1'

describe('CompaniesService', () => {
  const service = new CompaniesService()

  it("lists only the caller's companies by name, with a summary of their WhatsApp numbers", async () => {
    const { client, queries } = fakeDb(() => ({
      data: [
        { ...companyRow, whatsapp_phone_numbers: [whatsappRow], company_users: [{ user_id: USER }] },
        { ...companyRow, id: '6f1d2c1e-0000-4000-8000-000000000002', whatsapp_phone_numbers: [], company_users: [{ user_id: USER }] },
      ],
      error: null,
    }))

    const companies = await service.list(client, USER)

    expect(companies).toHaveLength(2)
    expect(companies[0]?.whatsapp.connectionStatus).toBe('connected')
    expect(companies[1]?.whatsapp.connectionStatus).toBe('not_configured')
    expect(companies[0]).not.toHaveProperty('company_users')
    expect(companies[0]).not.toHaveProperty('whatsapp_phone_numbers')

    const [q] = queries
    expect(q?.table).toBe('companies')
    // Explicit number columns: never the credential reference.
    expect(callsTo(q!, 'select')).toEqual([['*, whatsapp_phone_numbers(id, connection_status, created_at), company_users!inner(user_id)']])
    expect(callsTo(q!, 'eq')).toEqual([['company_users.user_id', USER]])
    expect(callsTo(q!, 'order')).toEqual([
      ['name', { ascending: true }],
      ['id', { ascending: true }],
    ])
  })

  it('gets one company only through the caller membership', async () => {
    const { client, queries } = fakeDb(() => ({
      data: { ...companyRow, whatsapp_phone_numbers: [whatsappRow], company_users: [{ user_id: USER }] },
      error: null,
    }))

    const company = await service.get(client, USER, companyRow.id)

    expect(company).toMatchObject({ id: companyRow.id, initials: 'NS', settings: { ownerSummaryWeekday: 'monday' } })
    expect(callsTo(queries[0]!, 'eq')).toEqual([
      ['company_users.user_id', USER],
      ['id', companyRow.id],
    ])
  })

  it('returns 404 for a company the caller is not a member of', async () => {
    const { client } = fakeDb(() => ({ data: null, error: null }))
    await expect(service.get(client, USER, companyRow.id)).rejects.toBeInstanceOf(NotFoundException)
  })

  it('maps an unreachable database to 503', async () => {
    const { client } = fakeDb(() => ({ data: null, error: { code: 'PGRST002', message: 'schema cache' } }))
    await expect(service.list(client, USER)).rejects.toBeInstanceOf(ServiceUnavailableException)
  })
})

const COMPANY = companyRow.id
const isWrite = (query: RecordedQuery): boolean => ['update', 'upsert', 'insert'].some((method) => callsTo(query, method).length > 0)

describe('assertActiveCompany', () => {
  it('accepts the X-Company-Id company in any letter case and refuses another company', () => {
    expect(() => assertActiveCompany(COMPANY.toUpperCase(), { companyId: COMPANY, role: 'company_admin' })).not.toThrow()
    expect(() => assertActiveCompany('6f1d2c1e-0000-4000-8000-000000000002', { companyId: COMPANY, role: 'company_admin' })).toThrow(
      BadRequestException,
    )
  })
})

describe('updateCompanyBodySchema', () => {
  it('accepts profile and settings fields and clears optional text with an empty string', () => {
    expect(
      updateCompanyBodySchema.parse({
        name: ' Nexus ',
        tradingName: '',
        settings: { paymentReminderOffsetsDays: { initial: 2, overdue: 7, followUp: 14 }, ownerSummaryWeekday: 'friday' },
      }),
    ).toEqual({
      name: 'Nexus',
      tradingName: null,
      settings: { paymentReminderOffsetsDays: { initial: 2, overdue: 7, followUp: 14 }, ownerSummaryWeekday: 'friday' },
    })
  })

  it.each([
    ['nothing to change', {}],
    ['empty settings', { settings: {} }],
    ['platform-managed status', { name: 'Nexus', status: 'suspended' }],
    ['platform-managed initials', { name: 'Nexus', initials: 'XX' }],
    ['the country', { name: 'Nexus', country: 'Namibia' }],
    // Tenant-message approval is not a setting at all (always required); an attempt to send one is refused.
    ['an attempt to turn off tenant-message approval', { settings: { requireApprovalForTenantMessages: false } }],
    ['the timezone', { settings: { timezone: 'Africa/Johannesburg' } }],
    ['reminder offsets out of order', { settings: { paymentReminderOffsetsDays: { initial: 10, overdue: 5, followUp: 20 } } }],
    ['a non-positive notice day', { settings: { leaseExpiryNoticeDays: [90, 0] } }],
    ['a repeated notice day', { settings: { leaseExpiryNoticeDays: [90, 90] } }],
    ['a bad postal code', { address: { line1: '1 Main', suburb: 'Sandton', city: 'Johannesburg', province: 'Gauteng', postalCode: '21' } }],
    ['a bad email', { contactEmail: 'nope' }],
  ])('rejects %s', (_label, body) => {
    expect(updateCompanyBodySchema.safeParse(body).success).toBe(false)
  })
})

describe('toCompanyPatch', () => {
  it('writes only the granted columns for the fields given, a whole address at a time', () => {
    const body = updateCompanyBodySchema.parse({
      contactPhone: '+27 11 555 0199',
      address: { line1: '1 Main Road', suburb: 'Hatfield', city: 'Pretoria', province: 'Gauteng', postalCode: '0083' },
      settings: { leaseExpiryNoticeDays: [120, 60], installmentReminderLeadDays: 0, paymentReminderOffsetsDays: { initial: 1, overdue: 5, followUp: 9 } },
    })
    expect(toCompanyPatch(body)).toEqual({
      contact_phone: '+27 11 555 0199',
      address_line1: '1 Main Road',
      address_line2: null,
      suburb: 'Hatfield',
      city: 'Pretoria',
      province: 'Gauteng',
      postal_code: '0083',
      lease_expiry_notice_days: [120, 60],
      installment_reminder_lead_days: 0,
      payment_reminder_initial_days: 1,
      payment_reminder_overdue_days: 5,
      payment_reminder_follow_up_days: 9,
    })
  })
})

describe('CompaniesService.update', () => {
  const service = new CompaniesService()

  it('updates the company by id and returns it read through the caller membership', async () => {
    const { client, queries } = fakeDb((query) =>
      isWrite(query) ? { data: { id: COMPANY }, error: null } : { data: { ...companyRow, name: 'Renamed', whatsapp_phone_numbers: [], company_users: [{ user_id: USER }] }, error: null },
    )

    const company = await service.update(client, USER, COMPANY, updateCompanyBodySchema.parse({ name: 'Renamed' }))

    expect(company).toMatchObject({ id: COMPANY, name: 'Renamed' })
    const update = queries.find(isWrite)
    expect(callsTo(update!, 'update')).toEqual([[{ name: 'Renamed' }]])
    expect(callsTo(update!, 'eq')).toEqual([['id', COMPANY]])
    expect(callsTo(queries[1]!, 'eq')).toEqual([
      ['company_users.user_id', USER],
      ['id', COMPANY],
    ])
  })

  it('maps a refused column (42501) to 403 and a broken settings rule (23514) to 422', async () => {
    const denied = fakeDb(() => ({ data: null, error: { code: '42501', message: 'permission denied for table companies' } }))
    await expect(service.update(denied.client, USER, COMPANY, updateCompanyBodySchema.parse({ name: 'X' }))).rejects.toBeInstanceOf(
      ForbiddenException,
    )
    const invalid = fakeDb(() => ({ data: null, error: { code: '23514', message: 'companies_reminder_offsets_ordered' } }))
    await expect(service.update(invalid.client, USER, COMPANY, updateCompanyBodySchema.parse({ name: 'X' }))).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    )
  })

  it('returns 404 when the update matched no visible company', async () => {
    const { client, queries } = fakeDb(() => ({ data: null, error: null }))
    await expect(service.update(client, USER, COMPANY, updateCompanyBodySchema.parse({ name: 'X' }))).rejects.toBeInstanceOf(NotFoundException)
    expect(queries).toHaveLength(1)
  })
})

describe('CompaniesService.configureWhatsApp', () => {
  const service = new CompaniesService()
  const body = configureWhatsAppBodySchema.parse({
    businessAccountId: '102938475610',
    phoneNumberId: '564738291045',
    displayName: 'Nexus Solution',
    displayNumber: '+27 11 555 0100',
  })

  it("adds the number or updates the company's number with that id, and returns it without the credential reference", async () => {
    const { client, queries } = fakeDb(() => ({ data: { ...numberRow, access_token_reference: 'secret://vault/x' }, error: null }))

    const number = await service.configureWhatsApp(client, COMPANY, body)

    expect(number).toMatchObject({ businessAccountId: '102938475610', phoneNumberId: '564738291045', connectionStatus: 'pending_verification', webhookConfigured: false })
    expect(number).not.toHaveProperty('lastVerifiedAt')
    expect(JSON.stringify(number)).not.toContain('secret:')
    const [q] = queries
    expect(q?.table).toBe('whatsapp_phone_numbers')
    expect(callsTo(q!, 'upsert')).toEqual([
      [
        {
          company_id: COMPANY,
          business_account_id: '102938475610',
          phone_number_id: '564738291045',
          display_name: 'Nexus Solution',
          display_number: '+27 11 555 0100',
        },
        { onConflict: 'company_id,phone_number_id' },
      ],
    ])
    expect(String(callsTo(q!, 'select')[0]?.[0])).not.toMatch(/\*|access_token_reference/)
  })

  it("corrects the company's number named by numberId instead of adding a second one", async () => {
    const numberId = '6f1d2c1e-0000-4000-8000-0000000000d1'
    const { client, queries } = fakeDb(() => ({ data: { ...numberRow, id: numberId }, error: null }))

    const number = await service.configureWhatsApp(client, COMPANY, configureWhatsAppBodySchema.parse({ ...body, numberId }))

    expect(number.id).toBe(numberId)
    const [q] = queries
    expect(q?.table).toBe('whatsapp_phone_numbers')
    expect(callsTo(q!, 'upsert')).toEqual([])
    expect(callsTo(q!, 'update')).toEqual([
      [{ business_account_id: '102938475610', phone_number_id: '564738291045', display_name: 'Nexus Solution', display_number: '+27 11 555 0100' }],
    ])
    expect(callsTo(q!, 'eq')).toEqual([
      ['id', numberId],
      ['company_id', COMPANY],
    ])
    expect(String(callsTo(q!, 'select')[0]?.[0])).not.toMatch(/\*|access_token_reference/)
  })

  it("answers 404 when numberId is not one of the company's numbers", async () => {
    const { client } = fakeDb(() => ({ data: null, error: null }))
    const numberId = '6f1d2c1e-0000-4000-8000-0000000000d2'
    await expect(service.configureWhatsApp(client, COMPANY, configureWhatsAppBodySchema.parse({ ...body, numberId }))).rejects.toBeInstanceOf(
      NotFoundException,
    )
  })

  it('maps a refusal to 403', async () => {
    const { client } = fakeDb(() => ({ data: null, error: { code: '42501', message: 'new row violates row-level security policy' } }))
    await expect(service.configureWhatsApp(client, COMPANY, body)).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('validates the identifiers and display number', () => {
    expect(configureWhatsAppBodySchema.safeParse({ ...body, phoneNumberId: 'abc' }).success).toBe(false)
    expect(configureWhatsAppBodySchema.safeParse({ ...body, displayNumber: '011 555 0100' }).success).toBe(false)
    expect(configureWhatsAppBodySchema.safeParse({ ...body, accessTokenReference: 'secret://x' }).success).toBe(false)
    expect(configureWhatsAppBodySchema.safeParse({ ...body, numberId: 'not-a-uuid' }).success).toBe(false)
    expect(configureWhatsAppBodySchema.safeParse({ ...body, connectionStatus: 'connected' }).success).toBe(false)
  })
})

describe('CompaniesService.onboarding', () => {
  const service = new CompaniesService()

  interface Facts {
    company?: FakeResult
    whatsapp?: FakeResult
    members?: number
    invitations?: number
    properties?: number
    verifiedLeases?: number
    statements?: number
  }

  function onboardingDb(facts: Facts = {}) {
    const counted = (count: number): FakeResult => ({ data: null, error: null, count })
    return fakeDb((query) => {
      switch (query.table) {
        case 'companies':
          return facts.company ?? { data: companyRow, error: null }
        case 'whatsapp_phone_numbers':
          return facts.whatsapp ?? { data: [], error: null }
        case 'company_users':
          return counted(facts.members ?? 1)
        case 'company_invitations':
          return counted(facts.invitations ?? 0)
        case 'properties':
          return counted(facts.properties ?? 0)
        case 'leases':
          return counted(facts.verifiedLeases ?? 0)
        default:
          return counted(facts.statements ?? 0)
      }
    })
  }

  it('reports a new company with only its details filled in', async () => {
    const { client, queries } = onboardingDb()

    expect(await service.onboarding(client, COMPANY)).toEqual({
      companyId: COMPANY,
      companyDetails: true,
      whatsappConfigured: false,
      whatsappConnected: false,
      teamInvited: false,
      propertyAdded: false,
      leaseVerified: false,
      statementUploaded: false,
      complete: false,
    })
    for (const query of queries) {
      expect(callsTo(query, 'eq')[0]).toEqual([query.table === 'companies' ? 'id' : 'company_id', COMPANY])
    }
    const leases = queries.find((q) => q.table === 'leases')
    expect(callsTo(leases!, 'eq')).toContainEqual(['verified', true])
    expect(callsTo(leases!, 'select')).toEqual([['id', { count: 'exact', head: true }]])
  })

  it('is complete once every required step is done, also without a team', async () => {
    const { client } = onboardingDb({
      whatsapp: { data: [{ connection_status: 'pending_verification' }, { connection_status: 'connected' }], error: null },
      properties: 2,
      verifiedLeases: 1,
      statements: 5,
    })
    expect(await service.onboarding(client, COMPANY)).toMatchObject({ whatsappConfigured: true, whatsappConnected: true, teamInvited: false, complete: true })
  })

  it('counts a team as invited with a second member or any invitation', async () => {
    expect(await service.onboarding(onboardingDb({ members: 2 }).client, COMPANY)).toMatchObject({ teamInvited: true })
    expect(await service.onboarding(onboardingDb({ invitations: 1 }).client, COMPANY)).toMatchObject({ teamInvited: true })
  })

  it('is not complete while WhatsApp awaits verification or details are blank', async () => {
    const pending = onboardingDb({
      company: { data: { ...companyRow, contact_phone: ' ' }, error: null },
      whatsapp: { data: [{ connection_status: 'pending_verification' }], error: null },
      properties: 1,
      verifiedLeases: 1,
      statements: 1,
    })
    expect(await service.onboarding(pending.client, COMPANY)).toMatchObject({
      companyDetails: false,
      whatsappConfigured: true,
      whatsappConnected: false,
      complete: false,
    })
  })

  it('returns 404 when the company is not visible and maps count errors', async () => {
    await expect(service.onboarding(onboardingDb({ company: { data: null, error: null } }).client, COMPANY)).rejects.toBeInstanceOf(NotFoundException)
    const failing = fakeDb((query) =>
      query.table === 'companies' ? { data: companyRow, error: null } : { data: null, error: { code: 'PGRST002', message: 'schema cache' } },
    )
    await expect(service.onboarding(failing.client, COMPANY)).rejects.toBeInstanceOf(ServiceUnavailableException)
  })
})
