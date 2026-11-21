import { unwrap } from '@leaseguard/api-client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { localSql } from '../fixtures/local-db.ts'
import { apiAs, apiErrorOf, check, expectOk, serviceRole, world } from './support/clients.ts'

/**
 * Settings → Message templates (ticket SG-01) through the real API and the local database. Company A has a connected
 * number and templates synced from Meta (written as the worker's sync would). Every member reads the seven templated
 * types; only a company admin chooses a template; the API and the database refuse a template that cannot serve a
 * type (with every reason); choosing is audited; another company's template is never found; a sync is queued for the
 * worker; company B sees none of it.
 */

const unique = `${Date.now()}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`
const ACCOUNT = `${unique}61`
const PHONE = `${unique}62`
const ACCOUNT_B = `${unique}71`
const META = { statement: `${unique}63`, promo: `${unique}64`, renewal: `${unique}65`, b: `${unique}72` }
const NAME = (suffix: string) => `it_${suffix}_${unique}`
const ids: Record<keyof typeof META, string> = { statement: '', promo: '', renewal: '', b: '' }
const STATEMENT_BODY = 'Good day {{1}}. Your {{2}} statement is attached.'

beforeAll(async () => {
  const a = world().companies.a.id
  const b = world().companies.b.id
  const db = serviceRole()
  expectOk(
    await db.from('whatsapp_business_accounts').insert([
      { company_id: a, business_account_id: ACCOUNT },
      { company_id: b, business_account_id: ACCOUNT_B },
    ]),
    'Insert the accounts',
  )
  expectOk(
    await db.from('whatsapp_phone_numbers').insert({
      company_id: a,
      business_account_id: ACCOUNT,
      phone_number_id: PHONE,
      display_name: 'Atlas Leasing',
      display_number: `+27 11 555 ${PHONE.slice(-4)}`,
      connection_status: 'connected',
      webhook_configured: true,
      last_verified_at: new Date().toISOString(),
      access_token_reference: `secret://env/WHATSAPP_ACCESS_TOKEN_${a.replaceAll('-', '')}`,
    }),
    'Insert the connected number',
  )
  const rows = check(
    await db
      .from('whatsapp_message_templates')
      .insert([
        { company_id: a, business_account_id: ACCOUNT, meta_template_id: META.statement, name: NAME('statement'), language: 'en_ZA', category: 'UTILITY', status: 'APPROVED', body: STATEMENT_BODY, header_format: 'DOCUMENT' },
        { company_id: a, business_account_id: ACCOUNT, meta_template_id: META.promo, name: NAME('promo'), language: 'en', category: 'MARKETING', status: 'PENDING', body: 'Hello {{1}}.' },
        { company_id: a, business_account_id: ACCOUNT, meta_template_id: META.renewal, name: NAME('renewal'), language: 'en', category: 'UTILITY', status: 'APPROVED', body: 'Your lease renewal is due on {{1}}.' },
        { company_id: b, business_account_id: ACCOUNT_B, meta_template_id: META.b, name: NAME('b'), language: 'en', category: 'UTILITY', status: 'APPROVED', body: 'Hello {{1}}.' },
      ])
      .select('id, meta_template_id'),
    'Insert the synced templates',
  )
  for (const key of Object.keys(META) as (keyof typeof META)[]) ids[key] = rows.find((r) => r.meta_template_id === META[key])!.id
})

afterAll(async () => {
  const db = serviceRole()
  const a = world().companies.a.id
  expectOk(await db.from('message_type_templates').delete().eq('company_id', a), 'Delete the mappings')
  expectOk(await db.from('message_templates').delete().eq('company_id', a).like('meta_template_name', `it_%_${unique}`), 'Delete the templates')
  expectOk(await db.from('whatsapp_message_templates').delete().in('meta_template_id', Object.values(META)), 'Delete the synced templates')
  expectOk(await db.from('whatsapp_phone_numbers').delete().eq('phone_number_id', PHONE), 'Delete the number')
  expectOk(await db.from('whatsapp_business_accounts').delete().in('business_account_id', [ACCOUNT, ACCOUNT_B]), 'Delete the accounts')
})

describe('message templates: reading', () => {
  it('lists the seven templated types for every member, tenant types first, none sendable before a template is chosen', async () => {
    const settings = await unwrap(apiAs('readOnly', 'a').GET('/api/v1/message-templates'))
    expect(settings.whatsappConnected).toBe(true)
    expect(settings.types.map((t) => [t.messageType, t.audience, t.sendable, t.mapping])).toEqual([
      ['monthly_statement', 'tenant', false, undefined],
      ['initial_payment_reminder', 'tenant', false, undefined],
      ['overdue_payment_reminder', 'tenant', false, undefined],
      ['follow_up_payment_reminder', 'tenant', false, undefined],
      ['arrangement_installment_reminder', 'tenant', false, undefined],
      ['owner_weekly_summary', 'property_owner', false, undefined],
      ['owner_query_response', 'property_owner', false, undefined],
    ])
  })

  it("lists the synced templates with Meta's text and header format", async () => {
    const templates = await unwrap(apiAs('readOnly', 'a').GET('/api/v1/integrations/whatsapp/message-templates'))
    expect(templates.find((t) => t.id === ids.statement)).toMatchObject({ body: STATEMENT_BODY, headerFormat: 'DOCUMENT' })
  })
})

describe('message templates: choosing', () => {
  it('lets a company admin choose an approved Utility template for the monthly statement, and audits it', async () => {
    const chosen = await unwrap(
      apiAs('admin', 'a').PUT('/api/v1/message-templates/{messageType}', {
        params: { path: { messageType: 'monthly_statement' } },
        body: { whatsappTemplateId: ids.statement },
      }),
    )
    expect(chosen).toMatchObject({
      messageType: 'monthly_statement',
      audience: 'tenant',
      sendable: true,
      mapping: {
        whatsappTemplateId: ids.statement,
        metaTemplateName: NAME('statement'),
        language: 'en_ZA',
        category: 'utility',
        body: STATEMENT_BODY,
        variables: ['Tenant name', 'Statement period'],
        approvalStatus: 'approved',
        metaStatus: 'APPROVED',
        supportsDocumentAttachment: true,
        metaBodyChanged: false,
        mappedByUserId: world().users.admin.id,
        mappedByName: world().users.admin.fullName,
      },
    })
    const audit = (await localSql(
      `select summary, actor_user_id from public.audit_logs where entity_type = 'message_template' and entity_id = '${chosen.mapping!.templateId}'`,
    )) as { summary: string; actor_user_id: string }[]
    expect(audit).toEqual([{ summary: `Monthly statement now sent with WhatsApp template ${NAME('statement')} (en_ZA)`, actor_user_id: world().users.admin.id }])

    const settings = await unwrap(apiAs('manager', 'a').GET('/api/v1/message-templates'))
    expect(settings.types[0]).toMatchObject({ messageType: 'monthly_statement', sendable: true })
  })

  it('refuses a property manager and a read-only member (403)', async () => {
    for (const user of ['manager', 'readOnly'] as const) {
      const error = await apiErrorOf(
        unwrap(
          apiAs(user, 'a').PUT('/api/v1/message-templates/{messageType}', {
            params: { path: { messageType: 'initial_payment_reminder' } },
            body: { whatsappTemplateId: ids.statement },
          }),
        ),
      )
      expect(error.status, user).toBe(403)
    }
  })

  it('refuses a template that cannot serve a tenant type with every reason (422)', async () => {
    const promo = await apiErrorOf(
      unwrap(
        apiAs('admin', 'a').PUT('/api/v1/message-templates/{messageType}', {
          params: { path: { messageType: 'initial_payment_reminder' } },
          body: { whatsappTemplateId: ids.promo },
        }),
      ),
    )
    expect(promo.status).toBe(422)
    expect(promo.messages).toEqual([
      `Meta has not approved "${NAME('promo')}" (Pending). Only approved templates can be chosen.`,
      `A tenant message needs a Utility template for statement and payment messages; "${NAME('promo')}" is Marketing.`,
    ])
    const renewal = await apiErrorOf(
      unwrap(
        apiAs('admin', 'a').PUT('/api/v1/message-templates/{messageType}', {
          params: { path: { messageType: 'overdue_payment_reminder' } },
          body: { whatsappTemplateId: ids.renewal },
        }),
      ),
    )
    expect(renewal.status).toBe(422)
    expect(renewal.messages).toEqual(['Tenant messages may not mention: renewal option'])
  })

  it('refuses a template already sending another type, through the database (422)', async () => {
    const error = await apiErrorOf(
      unwrap(
        apiAs('admin', 'a').PUT('/api/v1/message-templates/{messageType}', {
          params: { path: { messageType: 'initial_payment_reminder' } },
          body: { whatsappTemplateId: ids.statement },
        }),
      ),
    )
    expect(error.status).toBe(422)
    expect(error.messages).toEqual([`"${NAME('statement')}" (en_ZA) already sends Monthly statement messages. A template sends one message type.`])
  })

  it("never finds another company's template (404), and refuses a type sent without a template (400)", async () => {
    const other = await apiErrorOf(
      unwrap(
        apiAs('admin', 'a').PUT('/api/v1/message-templates/{messageType}', {
          params: { path: { messageType: 'owner_weekly_summary' } },
          body: { whatsappTemplateId: ids.b },
        }),
      ),
    )
    expect(other.status).toBe(404)
    const manual = await apiErrorOf(
      unwrap(
        apiAs('admin', 'a').PUT('/api/v1/message-templates/{messageType}', {
          // @ts-expect-error: manual messages are not templated, so the type does not allow it either
          params: { path: { messageType: 'manual' } },
          body: { whatsappTemplateId: ids.statement },
        }),
      ),
    )
    expect(manual.status).toBe(400)
  })

  it("keeps company B's settings apart", async () => {
    const settings = await unwrap(apiAs('manager', 'b').GET('/api/v1/message-templates'))
    expect(settings.whatsappConnected).toBe(false)
    expect(settings.types.every((t) => t.mapping === undefined)).toBe(true)
  })
})

describe('message templates: sync', () => {
  it("queues a sync of the connected number's account for a company admin (202), and refuses others", async () => {
    // One sync per connected WhatsApp Business Account of the company (the world may connect others besides this file's).
    const accounts = (await localSql(
      `select count(distinct business_account_id)::int as n from public.whatsapp_phone_numbers where company_id = '${world().companies.a.id}' and connection_status = 'connected'`,
    )) as { n: number }[]
    const queued = await unwrap(apiAs('admin', 'a').POST('/api/v1/message-templates/sync'))
    expect(queued).toMatchObject({ queued: accounts[0]!.n })
    expect(queued.queued).toBeGreaterThanOrEqual(1)
    expect((await apiErrorOf(unwrap(apiAs('manager', 'a').POST('/api/v1/message-templates/sync')))).status).toBe(403)
  })
})
