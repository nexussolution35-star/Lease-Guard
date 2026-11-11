import { spawn } from 'node:child_process'
import { createHash, createHmac, randomBytes } from 'node:crypto'
import path from 'node:path'

import { createApiClient, unwrap, type ApiClient } from '@leaseguard/api-client'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { AgentPrompt } from '../../backend/src/messaging/agent-llm.ts'
import { FakeAgentLlm } from '../../backend/src/messaging/agent.test-helpers.ts'
import { apiEnvironment, freePort, startApi, type ApiBuild, type RunningApi } from '../fixtures/api-server.ts'
import { localSql } from '../fixtures/local-db.ts'
import { REPO_ROOT, TEST_OUTPUT_ROOT } from '../fixtures/paths.ts'
import { deleteKeysWithPrefix } from '../fixtures/redis.ts'
import { destroyRecords } from '../fixtures/world.ts'
import { apiErrorOf, check, expectOk, integration, serviceRole } from './support/clients.ts'
import { FakeMetaGraph, type FakeBusiness } from './support/fake-meta-graph.ts'
import { type InProcessWorker, startInProcessWorker } from './support/in-process-worker.ts'

/**
 * Acceptance (ticket 14): Business A and Business B stay apart, end to end on the local stack.
 *
 * Nexus creates two companies with the operator command (`platform:create-company`) and each admin accepts their
 * invitation. Each admin connects a different WhatsApp number through Embedded Signup, configures a different AI agent
 * and knowledge base, sends a test message and activates WhatsApp. A contact then writes to both numbers, a tenant of A
 * writes to A, and Meta retries and re-orders its webhooks. Everything goes through the real paths: the API process
 * (signed webhooks, code exchange, every member action) and the worker's real processors on BullMQ (verification,
 * routing, the agent, delivery, test messages), with two fakes only: Meta's Graph API (a local server, see
 * support/fake-meta-graph.ts) and the agent's model (FakeAgentLlm, which answers only from the prompt it is given and
 * records every prompt). Nothing calls Meta or Anthropic.
 *
 * Asserted: each agent answers from its own company's approved knowledge only and through its own number and token;
 * neither company's admin can see the other's contacts, conversations, messages, knowledge or agent runs, through the
 * API or directly through PostgREST with their own sign-in; duplicates create nothing twice; a tenant gets no automatic
 * reply and a person is asked instead.
 */

type Business = 'atlas' | 'baobab'
const BUSINESSES: readonly Business[] = ['atlas', 'baobab']
const other = (b: Business): Business => (b === 'atlas' ? 'baobab' : 'atlas')

const unique = `${Date.now()}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`
const META = { appId: '616161616161', appSecret: 'acceptance-app-secret-not-a-real-one', configId: '717171717171', verifyToken: 'acceptance-verify-token', graphVersion: 'v27.0' }

const FAKE_META: Record<Business, FakeBusiness> = {
  atlas: {
    code: `AQD-atlas-${unique}`,
    token: `EAAG-acceptance-atlas-${unique}`,
    businessAccountId: `${unique}11`,
    phoneNumberId: `${unique}12`,
    displayPhoneNumber: '+27 11 555 0141',
    verifiedName: 'Atlas Properties',
    templateId: `${unique}13`,
  },
  baobab: {
    code: `AQD-baobab-${unique}`,
    token: `EAAG-acceptance-baobab-${unique}`,
    businessAccountId: `${unique}21`,
    phoneNumberId: `${unique}22`,
    displayPhoneNumber: '+27 12 555 0242',
    verifiedName: 'Baobab Estates',
    templateId: `${unique}23`,
  },
}

// In letters: a long run of digits in an answer would (rightly) trip the agent's bank-details guard.
const marker = unique.replace(/\d/g, (d) => 'abcdefghij'[Number(d)]!)

/** What each company's admin configures; the fake model may only answer from what reaches its prompt. */
const KNOWLEDGE = {
  atlas: {
    faq: { question: 'Where do visitors park?', answer: `Atlas visitors park in basement P2 (${marker}).`, keyword: 'park' },
    entry: { title: 'Office hours', content: `Atlas Properties is open weekdays from eight to five (${marker}).` },
    draft: { question: 'Draft question?', answer: `Atlas draft answer, never shown to the agent (${marker}).` },
  },
  baobab: {
    faq: { question: 'How do I get an access card?', answer: `Baobab access cards are issued at the main reception (${marker}).`, keyword: 'access card' },
    entry: { title: 'Visitor rules', content: `Baobab Estates signs in every visitor at the gate (${marker}).` },
    draft: { question: 'Draft question?', answer: `Baobab draft answer, never shown to the agent (${marker}).` },
  },
} as const

// The contact writes to both businesses from one number; the tenant is a tenant of Atlas only.
const CONTACT = `2786${unique.slice(-7)}`
const TENANT = `2787${unique.slice(-7)}`
const TEST_TO = { atlas: `+2788${unique.slice(-7)}`, baobab: `+2789${unique.slice(-7)}` }

/** The acceptance API process: a test Meta app (fake Graph), the webhook secrets and its own queue prefix. */
const BUILD: ApiBuild = { dirName: '.dev-integration', logFile: path.join(TEST_OUTPUT_ROOT, 'integration', 'api-acceptance.log') }
const WORKER_LOG = path.join(TEST_OUTPUT_ROOT, 'integration', 'worker-acceptance.log')

interface Company {
  id: string
  name: string
  adminUserId: string
  adminEmail: string
  token: string
  numberId: string
  tenantId: string
}

const companies = {} as Record<Business, Company>
const createdCompanyIds: string[] = []
const createdUserIds: string[] = []
const webhookBodies: string[] = []

let graph: FakeMetaGraph
let api: RunningApi
let worker: InProcessWorker | undefined
/** The contact's first message to Atlas, exactly as Meta first delivered it (retried byte for byte later). */
let firstAtlasBody = ''
let queuePrefix: string
const llm = new FakeAgentLlm(answerFromPrompt)

/**
 * The fake model: answers a question only when the prompt's knowledge holds the matching approved FAQ answer, as the
 * real model is instructed to; anything else goes to a person.
 */
function answerFromPrompt(prompt: AgentPrompt) {
  const turn = prompt.turn.toLowerCase()
  const known = BUSINESSES.map((b) => KNOWLEDGE[b].faq).find((faq) => prompt.knowledge.includes(faq.answer) && turn.includes(faq.keyword))
  return known
    ? { action: 'reply' as const, replyText: known.answer, category: 'faq' as const, confidence: 0.95 }
    : { action: 'handover' as const, handoverReason: 'Not covered by the approved information', category: 'other' as const, confidence: 0.9 }
}

// ------------------------------------------------------------------------------------------------ helpers

/** The API client of a company's admin, acting in `company` (their own unless a test says otherwise). */
function adminOf(business: Business, company: Business = business): ApiClient {
  const { token } = companies[business]
  const companyId = companies[company].id
  return createApiClient({ baseUrl: api.baseUrl, getAccessToken: () => token, getCompanyId: () => companyId })
}

/** PostgREST with a company admin's own sign-in: Row Level Security applies. */
function signedIn(business: Business): SupabaseClient {
  const ctx = integration()
  return createClient(ctx.supabaseUrl, ctx.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${companies[business].token}` } },
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

const sign = (body: string) => `sha256=${createHmac('sha256', META.appSecret).update(body).digest('hex')}`
const sha256 = (body: string) => createHash('sha256').update(body).digest('hex')

/** Delivers a payload the way Meta does: signed with the app secret, to the one shared webhook. */
async function deliver(body: string): Promise<void> {
  webhookBodies.push(body)
  const response = await fetch(`${api.baseUrl}/api/v1/webhooks/whatsapp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sign(body) },
    body,
  })
  expect(response.status).toBe(200)
}

function envelope(business: Business, value: Record<string, unknown>, extraChanges: unknown[] = []): string {
  const meta = FAKE_META[business]
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: meta.businessAccountId,
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: meta.displayPhoneNumber.replace(/\D/g, ''), phone_number_id: meta.phoneNumberId },
              ...value,
            },
          },
          ...extraChanges,
        ],
      },
    ],
  })
}

const nowSeconds = () => String(Math.floor(Date.now() / 1000))

function messageBody(business: Business, messageId: string, from: string, text: string, extraChanges: unknown[] = []): string {
  return envelope(
    business,
    {
      contacts: [{ wa_id: from, profile: { name: 'Sipho Contact' } }],
      messages: [{ id: messageId, from, timestamp: nowSeconds(), type: 'text', text: { body: text } }],
    },
    extraChanges,
  )
}

function statusBody(business: Business, providerMessageId: string, status: 'sent' | 'delivered' | 'read' | 'failed', at: number, recipient: string): string {
  return envelope(business, { statuses: [{ id: providerMessageId, status, timestamp: String(at), recipient_id: recipient }] })
}

/** The worker has stored and finished the payload (processed once, whatever Meta retried). */
async function processed(body: string) {
  return waitFor(`webhook payload ${sha256(body).slice(0, 12)} processed`, async () => {
    const rows = check(
      await serviceRole().from('whatsapp_webhook_events').select('processing_status, outcomes').eq('payload_sha256', sha256(body)),
      'Read the webhook event',
    ) as { processing_status: string; outcomes: { outcome: string }[] }[]
    return rows.length === 1 && rows[0]!.processing_status === 'processed' ? rows[0]! : null
  })
}

async function communication(business: Business, providerMessageId: string) {
  const rows = check(
    await serviceRole().from('communications').select('*').eq('company_id', companies[business].id).eq('external_message_id', providerMessageId),
    'Read the communication',
  ) as { id: string; conversation_id: string; status: string; direction: string; delivered_at: string | null; read_at: string | null }[]
  return rows
}

/** Unused two-letter initials (the operator command refuses initials or a name that already exist). */
async function freeInitials(taken: Set<string>): Promise<string> {
  const rows = check(await serviceRole().from('companies').select('initials'), 'Read company initials') as { initials: string }[]
  for (const row of rows) taken.add(row.initials)
  for (;;) {
    const letters = randomBytes(2)
    const initials = String.fromCharCode(65 + (letters[0]! % 26), 65 + (letters[1]! % 26))
    if (!taken.has(initials)) {
      taken.add(initials)
      return initials
    }
  }
}

/** Runs the operator command against the LOCAL stack only (explicit environment: backend/.env is never read). */
function platformCreateCompany(args: string[]): Promise<string> {
  const ctx = integration()
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(REPO_ROOT, 'infrastructure', 'scripts', 'platform-create-company.mjs'), ...args], {
      cwd: REPO_ROOT,
      env: { PATH: process.env.PATH ?? '', SUPABASE_URL: ctx.supabaseUrl, SUPABASE_SERVICE_ROLE_KEY: ctx.serviceRoleKey, WEB_APP_URL: 'http://localhost:5173' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()))
    child.on('error', reject)
    child.on('exit', (code) => (code === 0 ? resolve(output) : reject(new Error(`platform:create-company failed (${code}):\n${output}`))))
  })
}

/**
 * Nexus's path for a new client: the admin's account exists (confirmed, so no email is sent), the operator command
 * creates the company and invites them, and the admin accepts the invitation signed in.
 */
async function createBusiness(business: Business, name: string, taken: Set<string>): Promise<Company> {
  const ctx = integration()
  const email = `acceptance-${business}.${ctx.runId}.${unique}@leaseguard.test`
  const password = `${randomBytes(18).toString('base64url')}Aa1!`
  const created = await serviceRole().auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `${name} Admin` } })
  if (created.error || !created.data.user) throw new Error(`Create the admin of ${name} failed: ${created.error?.message}`)
  const adminUserId = created.data.user.id
  createdUserIds.push(adminUserId)

  const companyName = `${name} ${ctx.runId}${unique}`
  const output = await platformCreateCompany([
    '--name', companyName,
    '--initials', await freeInitials(taken),
    '--admin-email', email,
    '--admin-name', `${name} Admin`,
    '--address-line1', business === 'atlas' ? '1 Atlas Road' : '2 Baobab Lane',
    '--suburb', 'Sandton',
    '--city', 'Johannesburg',
    '--province', 'Gauteng',
    '--postal-code', '2196',
    '--contact-email', `office.${business}.${unique}@leaseguard.test`,
    '--contact-phone', business === 'atlas' ? '+27 11 555 0140' : '+27 12 555 0240',
  ])
  const companyId = /^Company:.*\s([0-9a-f-]{36}) \[created\]$/m.exec(output)?.[1]
  const invitationId = /^Invitation:\s+([0-9a-f-]{36}) sent, no email sent$/m.exec(output)?.[1]
  if (!companyId || !invitationId) throw new Error(`Unexpected platform:create-company output:\n${output}`)
  createdCompanyIds.push(companyId)
  expect(output).toContain('NOT AN ADMIN YET')

  const signIn = await createClient(ctx.supabaseUrl, ctx.anonKey, { auth: { persistSession: false, autoRefreshToken: false } }).auth.signInWithPassword({
    email,
    password,
  })
  if (signIn.error || !signIn.data.session) throw new Error(`Sign in as the admin of ${name} failed: ${signIn.error?.message}`)
  const token = signIn.data.session.access_token
  const me = createApiClient({ baseUrl: api.baseUrl, getAccessToken: () => token, getCompanyId: () => null })
  await unwrap(me.POST('/api/v1/me/invitations/{invitationId}/accept', { params: { path: { invitationId } } }))
  return { id: companyId, name: companyName, adminUserId, adminEmail: email, token, numberId: '', tenantId: '' }
}

// ------------------------------------------------------------------------------------------------ setup

beforeAll(async () => {
  const ctx = integration()
  queuePrefix = `${ctx.queuePrefix}-acceptance`
  graph = await FakeMetaGraph.start({ appId: META.appId, appSecret: META.appSecret, graphVersion: META.graphVersion }, FAKE_META, await freePort())
  api = await startApi(
    BUILD,
    apiEnvironment(BUILD, {
      API_PORT: String(await freePort()),
      SUPABASE_URL: ctx.supabaseUrl,
      SUPABASE_ANON_KEY: ctx.anonKey,
      REDIS_URL: ctx.redisUrl,
      QUEUE_PREFIX: queuePrefix,
      WHATSAPP_APP_ID: META.appId,
      WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID: META.configId,
      WHATSAPP_APP_SECRET: META.appSecret,
      WHATSAPP_WEBHOOK_VERIFY_TOKEN: META.verifyToken,
      WHATSAPP_GRAPH_API_URL: graph.url,
      WHATSAPP_GRAPH_API_VERSION: META.graphVersion,
    }),
  )
  worker = startInProcessWorker({
    supabaseUrl: ctx.supabaseUrl,
    serviceRoleKey: ctx.serviceRoleKey,
    redisUrl: ctx.redisUrl,
    queuePrefix,
    meta: { appId: META.appId, appSecret: META.appSecret, graphUrl: graph.url, graphVersion: META.graphVersion },
    llm,
    logFile: WORKER_LOG,
  })

  const taken = new Set<string>()
  companies.atlas = await createBusiness('atlas', 'Atlas Properties', taken)
  companies.baobab = await createBusiness('baobab', 'Baobab Estates', taken)

  // A tenant of Atlas (no API creates tenants; the tenant register is set up like the suite's world).
  const tenant = check(
    await serviceRole()
      .from('tenants')
      .insert({
        company_id: companies.atlas.id,
        legal_name: 'Umoya Coffee (Pty) Ltd',
        trading_name: 'Umoya Coffee',
        business_type: 'pty_ltd',
        contact_full_name: 'Umoya Contact',
        contact_role: 'Director',
        contact_phone: '+27 11 555 0200',
        whatsapp_number: `+${TENANT}`,
        whatsapp_verified: true,
        whatsapp_opted_out: false,
        status: 'active',
        industry: 'Retail',
      })
      .select('id')
      .single(),
    'Add a tenant of Atlas',
  ) as { id: string }
  companies.atlas.tenantId = tenant.id
}, 180_000)

afterAll(async () => {
  await worker?.stop()
  await api?.stop()
  await graph?.close()
  const ctx = integration()
  const db = serviceRole()
  // Webhook payloads and their job runs are stored before any company is known (no company_id).
  const hashes = [...new Set(webhookBodies.map(sha256))]
  if (hashes.length > 0) {
    expectOk(await db.from('whatsapp_webhook_events').delete().in('payload_sha256', hashes), 'Delete the webhook events')
    expectOk(
      await db.from('job_runs').delete().is('company_id', null).in('queue_job_id', hashes.map((h) => `whatsapp-webhook.${h}`)),
      'Delete the webhook job runs',
    )
  }
  for (const companyId of createdCompanyIds) {
    await localSql(`delete from vault.secrets where name like 'whatsapp_access_token:${companyId}:%'`)
  }
  if (queuePrefix) await deleteKeysWithPrefix(ctx.redisUrl, queuePrefix)
  // Everything else is company-scoped: removed (or, where audit_logs pins it, archived) and checked like the world.
  await destroyRecords(
    { url: ctx.supabaseUrl, anonKey: ctx.anonKey, serviceRoleKey: ctx.serviceRoleKey },
    { label: `Acceptance businesses ${unique}`, companyIds: createdCompanyIds, userIds: createdUserIds },
  )
}, 120_000)

// ------------------------------------------------------------------------------------------------ scenario

describe('Business A and Business B stay apart', () => {
  it('Nexus creates each business with the operator command, and each admin administers only their own', async () => {
    for (const business of BUSINESSES) {
      const me = await unwrap(adminOf(business).GET('/api/v1/me'))
      expect(me.memberships.map((m) => [m.companyId, m.role, m.company.name])).toEqual([[companies[business].id, 'company_admin', companies[business].name]])
    }
  })

  it('each admin connects a different number through Embedded Signup, and LeaseGuard verifies it with Meta', async () => {
    for (const business of BUSINESSES) {
      const meta = FAKE_META[business]
      const session = await unwrap(adminOf(business).POST('/api/v1/integrations/whatsapp/onboarding-sessions'))
      const result = await unwrap(
        adminOf(business).POST('/api/v1/integrations/whatsapp/onboarding-sessions/{sessionId}/complete', {
          params: { path: { sessionId: session.sessionId } },
          body: {
            state: session.state,
            event: 'FINISH',
            code: meta.code,
            sessionInfo: { phone_number_id: meta.phoneNumberId, messaging_account_ids: [meta.businessAccountId], business_id: `${unique}9`, is_on_biz_app: false },
          } as never,
        }),
      )
      expect(result).toMatchObject({ status: 'exchanged', businessAccountIds: [meta.businessAccountId], phoneNumberIds: [meta.phoneNumberId] })
      expect(JSON.stringify(result)).not.toContain(meta.token)
    }

    for (const business of BUSINESSES) {
      const number = await waitFor(`${business}'s number connected`, async () => {
        const accounts = await unwrap(adminOf(business).GET('/api/v1/integrations/whatsapp/business-accounts'))
        const found = accounts.flatMap((a) => a.numbers).find((n) => n.phoneNumberId === FAKE_META[business].phoneNumberId)
        return found?.connectionStatus === 'connected' ? found : null
      })
      companies[business].numberId = number.id
      expect(number).toMatchObject({ verifiedName: FAKE_META[business].verifiedName, webhookConfigured: true })
      // Each admin's list holds their own account and number only.
      const accounts = await unwrap(adminOf(business).GET('/api/v1/integrations/whatsapp/business-accounts'))
      expect(accounts.map((a) => a.businessAccountId)).toEqual([FAKE_META[business].businessAccountId])
    }

    // Each business token is in Vault under its own company only, and was only ever used on its own business's ids.
    for (const business of BUSINESSES) {
      const names = (await localSql(
        `select name from vault.secrets where name like 'whatsapp_access_token:${companies[business].id}:%'`,
      )) as { name: string }[]
      expect(names).toHaveLength(1)
    }
    // Each business's one-time code was exchanged once, by the API, for that business's token: no retry, no second use.
    expect(graph.requests.filter((r) => r.path === '/oauth/access_token').map((r) => [r.query.code, r.status])).toEqual([
      [FAKE_META.atlas.code, 200],
      [FAKE_META.baobab.code, 200],
    ])
    expect(graph.refused()).toEqual([])
    for (const request of graph.requests.filter((r) => r.business !== null)) {
      const meta = FAKE_META[request.business as Business]
      expect([meta.businessAccountId, meta.phoneNumberId]).toContain(request.path.split('/')[1])
    }
  })

  it('each admin configures a different AI agent and knowledge base', async () => {
    const allWeek = (['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const).map((day) => ({ day, opens: '00:00', closes: '24:00' }))
    for (const business of BUSINESSES) {
      const client = adminOf(business)
      const knowledge = KNOWLEDGE[business]
      await unwrap(
        client.PUT('/api/v1/whatsapp/agent', {
          body: {
            agentName: business === 'atlas' ? 'Atlas assistant' : 'Baobab assistant',
            businessDescription: business === 'atlas' ? 'Atlas Properties lets offices in Sandton.' : 'Baobab Estates lets warehouses in Pretoria.',
            tone: business === 'atlas' ? 'Friendly and brief' : 'Formal',
            timezone: 'Africa/Johannesburg',
            // Open all week, so the scenario does not depend on the time it runs.
            operatingHours: allWeek,
            languages: ['en'],
            policies: '',
            supportInstructions: '',
            escalationRules: '',
            permittedActions: ['answer_faq', 'draft_tenant_reply'],
            autoReplyEnabled: true,
            outOfHoursMessage: '',
            handoverContactUserIds: [companies[business].adminUserId],
          },
        }),
      )
      const faq = await unwrap(client.POST('/api/v1/whatsapp/agent/faqs', { body: { question: knowledge.faq.question, answer: knowledge.faq.answer } }))
      await unwrap(client.POST('/api/v1/whatsapp/agent/faqs/{faqId}/approve', { params: { path: { faqId: faq.id } } }))
      await unwrap(client.POST('/api/v1/whatsapp/agent/faqs', { body: knowledge.draft }))
      const entry = await unwrap(client.POST('/api/v1/whatsapp/agent/knowledge-entries', { body: knowledge.entry }))
      await unwrap(client.POST('/api/v1/whatsapp/agent/knowledge-entries/{entryId}/approve', { params: { path: { entryId: entry.id } } }))
    }
    for (const business of BUSINESSES) {
      const faqs = await unwrap(adminOf(business).GET('/api/v1/whatsapp/agent/faqs'))
      expect(faqs.map((f) => [f.answer, f.status]).sort()).toEqual(
        [
          [KNOWLEDGE[business].faq.answer, 'approved'],
          [KNOWLEDGE[business].draft.answer, 'draft'],
        ].sort(),
      )
    }
  })

  it('each admin sees and manages only their own WhatsApp setup: test message, then activation', async () => {
    for (const business of BUSINESSES) {
      const setup = await unwrap(adminOf(business).GET('/api/v1/integrations/whatsapp/setup'))
      const states = Object.fromEntries(setup.steps.map((s) => [s.step, s.state]))
      expect(states).toMatchObject({
        business_profile: 'done',
        meta_account: 'done',
        business_account: 'done',
        phone_number: 'done',
        webhook: 'done',
        message_templates: 'done',
        ai_agent: 'done',
        knowledge_base: 'done',
        test_message: 'action_needed',
      })
      expect(setup.readyForActivation).toBe(false)
      expect((await apiErrorOf(unwrap(adminOf(business).POST('/api/v1/integrations/whatsapp/activation'))))).toMatchObject({ status: 409 })
      // The other business's setup is closed to this admin.
      expect((await apiErrorOf(unwrap(adminOf(business, other(business)).GET('/api/v1/integrations/whatsapp/setup')))).status).toBe(403)
      expect((await apiErrorOf(unwrap(adminOf(business, other(business)).POST('/api/v1/integrations/whatsapp/activation')))).status).toBe(403)
    }

    for (const business of BUSINESSES) {
      const templates = await unwrap(adminOf(business).GET('/api/v1/integrations/whatsapp/message-templates'))
      expect(templates.map((t) => [t.businessAccountId, t.name, t.status])).toEqual([[FAKE_META[business].businessAccountId, 'hello_world', 'APPROVED']])
      await unwrap(
        adminOf(business).POST('/api/v1/integrations/whatsapp/test-messages', {
          body: { numberId: companies[business].numberId, templateId: templates[0]!.id, to: TEST_TO[business] },
        }),
      )
      const sent = await waitFor(`${business}'s test message sent`, async () =>
        graph.sends().find((s) => s.path === `/${FAKE_META[business].phoneNumberId}/messages` && JSON.stringify(s.body).includes(TEST_TO[business].slice(1))),
      )
      expect(sent.business).toBe(business)
      // Meta reports it delivered through the webhook; only that completes the step.
      await waitFor(`${business}'s test message recorded as sent`, async () => {
        const setup = await unwrap(adminOf(business).GET('/api/v1/integrations/whatsapp/setup'))
        return setup.latestTestMessage?.status === 'sent'
      })
      const delivered = statusBody(business, sent.messageId!, 'delivered', Math.floor(Date.now() / 1000), TEST_TO[business].slice(1))
      await deliver(delivered)
      await processed(delivered)
      const setup = await waitFor(`${business} ready for activation`, async () => {
        const current = await unwrap(adminOf(business).GET('/api/v1/integrations/whatsapp/setup'))
        return current.readyForActivation ? current : null
      })
      expect(setup.latestTestMessage).toMatchObject({ status: 'delivered' })
      await expect(unwrap(adminOf(business).POST('/api/v1/integrations/whatsapp/activation'))).resolves.toMatchObject({
        active: true,
        activatedByUserId: companies[business].adminUserId,
      })
    }
    // Each test message went out through its own business's number with its own token, once.
    for (const business of BUSINESSES) {
      expect(graph.sends().filter((s) => JSON.stringify(s.body).includes(TEST_TO[business].slice(1))).map((s) => s.business)).toEqual([business])
    }
  })

  it("a contact writing to both businesses is answered by each business's own agent, from its own knowledge, through its own number", async () => {
    const atlasBody = messageBody('atlas', `wamid.acceptance-atlas-${unique}`, CONTACT, 'Hello, where can visitors park?')
    firstAtlasBody = atlasBody
    const baobabBody = messageBody('baobab', `wamid.acceptance-baobab-${unique}`, CONTACT, 'Hi, how do I get an access card?')
    await deliver(atlasBody)
    // Meta retries a delivery it did not see acknowledged in time: the same body again.
    await deliver(atlasBody)
    await deliver(baobabBody)

    for (const [business, body] of [['atlas', atlasBody], ['baobab', baobabBody]] as const) {
      await processed(body)
      const reply = await waitFor(`${business}'s agent reply sent`, async () =>
        graph.sends().find((s) => s.business === business && JSON.stringify(s.body).includes(KNOWLEDGE[business].faq.answer)),
      )
      // Sent to the contact, from the business's own number, with the business's own token, with its own answer.
      expect(reply.path).toBe(`/${FAKE_META[business].phoneNumberId}/messages`)
      expect(reply.token).toBe(FAKE_META[business].token)
      expect(reply.body).toMatchObject({ to: CONTACT, type: 'text', text: { body: KNOWLEDGE[business].faq.answer } })
      // LeaseGuard recorded the send against the reply in that company only.
      await waitFor(`${business}'s reply recorded as sent`, async () => {
        const rows = await communication(business, reply.messageId!)
        return rows.length === 1 && rows[0]!.status === 'sent'
      })
      expect(await communication(other(business), reply.messageId!)).toEqual([])
    }

    // The model saw one prompt per message, each built from one company's approved knowledge only.
    const atlasPrompts = llm.prompts.filter((p) => p.turn.includes('visitors park'))
    const baobabPrompts = llm.prompts.filter((p) => p.turn.includes('access card'))
    expect(atlasPrompts).toHaveLength(1)
    expect(baobabPrompts).toHaveLength(1)
    const atlasPrompt = JSON.stringify(atlasPrompts[0])
    const baobabPrompt = JSON.stringify(baobabPrompts[0])
    expect(atlasPrompt).toContain(KNOWLEDGE.atlas.faq.answer)
    expect(atlasPrompt).toContain(KNOWLEDGE.atlas.entry.content)
    expect(baobabPrompt).toContain(KNOWLEDGE.baobab.faq.answer)
    expect(baobabPrompt).toContain(KNOWLEDGE.baobab.entry.content)
    for (const [prompt, own, theirs] of [[atlasPrompt, 'atlas', 'baobab'], [baobabPrompt, 'baobab', 'atlas']] as const) {
      expect(prompt).not.toContain(KNOWLEDGE[own].draft.answer)
      expect(prompt).not.toContain(KNOWLEDGE[theirs].faq.answer)
      expect(prompt).not.toContain(KNOWLEDGE[theirs].entry.content)
      expect(prompt).not.toContain(KNOWLEDGE[theirs].draft.answer)
      expect(prompt).not.toContain(theirs === 'atlas' ? 'Atlas' : 'Baobab')
      expect(prompt).not.toContain(companies[theirs].id)
    }

    // A question Baobab's approved information does not answer goes to one of Baobab's people, not to Atlas.
    const unanswered = messageBody('baobab', `wamid.acceptance-baobab-dog-${unique}`, CONTACT, 'Can I bring my dog to the warehouse?')
    await deliver(unanswered)
    await processed(unanswered)
    const [dogQuestion] = await waitFor("Baobab's unanswered question recorded", async () => {
      const rows = await communication('baobab', `wamid.acceptance-baobab-dog-${unique}`)
      return rows.length === 1 ? rows : null
    })
    const handover = await waitFor("Baobab's handover", async () => {
      const rows = check(await serviceRole().from('whatsapp_handovers').select('company_id, requested_by, status').eq('conversation_id', dogQuestion!.conversation_id), 'Read the handover') as unknown[]
      return rows.length === 1 ? rows[0] : null
    })
    expect(handover).toEqual({ company_id: companies.baobab.id, requested_by: 'agent', status: 'open' })

    // The same person is a separate contact in each company.
    const contacts = check(await serviceRole().from('whatsapp_contacts').select('company_id').eq('wa_id', CONTACT), 'Read the contacts') as { company_id: string }[]
    expect(contacts.map((c) => c.company_id).sort()).toEqual([companies.atlas.id, companies.baobab.id].sort())
  })

  it("Meta's retries and re-batched deliveries create nothing twice", async () => {
    const messageId = `wamid.acceptance-atlas-${unique}`
    // A late retry of exactly the first body (Meta retries for up to seven days)…
    const atlasBody = firstAtlasBody
    await deliver(atlasBody)
    // …and Meta re-batching the same message with another change into a new body.
    const rebatched = messageBody('atlas', messageId, CONTACT, 'Hello, where can visitors park?', [
      { field: 'messages', value: { messaging_product: 'whatsapp', metadata: { display_phone_number: '27115550141', phone_number_id: FAKE_META.atlas.phoneNumberId }, statuses: [] } },
    ])
    await deliver(rebatched)
    const outcome = await processed(rebatched)
    expect(outcome.outcomes.map((o) => o.outcome)).toContain('duplicate')

    // One stored payload per body, one message, one agent run, one model call, one reply sent.
    for (const body of [atlasBody, rebatched]) {
      const { count } = await serviceRole().from('whatsapp_webhook_events').select('id', { count: 'exact', head: true }).eq('payload_sha256', sha256(body))
      expect(count).toBe(1)
    }
    const inbound = await communication('atlas', messageId)
    expect(inbound).toHaveLength(1)
    // Give a wrongly re-queued agent run time to show up before counting.
    await new Promise((resolve) => setTimeout(resolve, 1500))
    const runs = check(await serviceRole().from('whatsapp_agent_runs').select('id, outcome').eq('communication_id', inbound[0]!.id), 'Read the agent runs') as { outcome: string }[]
    expect(runs.map((r) => r.outcome)).toEqual(['replied'])
    expect(llm.prompts.filter((p) => p.turn.includes('visitors park'))).toHaveLength(1)
    expect(graph.sends().filter((s) => JSON.stringify(s.body).includes(KNOWLEDGE.atlas.faq.answer))).toHaveLength(1)
    const outbound = check(
      await serviceRole().from('communications').select('id').eq('conversation_id', inbound[0]!.conversation_id).eq('direction', 'outbound'),
      'Read the replies',
    )
    expect(outbound).toHaveLength(1)
  })

  it("applies Meta's delivery statuses in any order, to the sending company's message only", async () => {
    const reply = graph.sends().find((s) => s.business === 'atlas' && JSON.stringify(s.body).includes(KNOWLEDGE.atlas.faq.answer))!
    const at = Math.floor(Date.now() / 1000)
    // Atlas's reply is only sent so far, so a status applied to it by mistake would show.
    expect(await communication('atlas', reply.messageId!)).toMatchObject([{ status: 'sent', delivered_at: null, read_at: null }])

    // Atlas's message id reported as read on Baobab's number: Baobab, the receiving number's company, has no such
    // message, so it is recorded as not found for Baobab and Atlas's reply does not move.
    // (An hour old, so the worker records it as not found at once instead of waiting for a send to be recorded.)
    const misrouted = statusBody('baobab', reply.messageId!, 'read', at - 3600, CONTACT)
    await deliver(misrouted)
    const misroutedEvent = await processed(misrouted)
    expect(misroutedEvent.outcomes).toEqual([
      {
        field: 'messages',
        phoneNumberId: FAKE_META.baobab.phoneNumberId,
        companyId: companies.baobab.id,
        statusId: reply.messageId,
        status: 'read',
        occurredAt: new Date((at - 3600) * 1000).toISOString(),
        outcome: 'not_found',
      },
    ])
    expect(await communication('baobab', reply.messageId!)).toEqual([])
    expect(await communication('atlas', reply.messageId!)).toMatchObject([{ status: 'sent', delivered_at: null, read_at: null }])

    // Meta does not order its callbacks: "read" arrives before "delivered".
    const read = statusBody('atlas', reply.messageId!, 'read', at + 2, CONTACT)
    const delivered = statusBody('atlas', reply.messageId!, 'delivered', at + 1, CONTACT)
    await deliver(read)
    await processed(read)
    await deliver(delivered)
    await processed(delivered)
    const [message] = await communication('atlas', reply.messageId!)
    expect(message).toMatchObject({ status: 'read' })
    expect(message!.delivered_at).not.toBeNull()
    expect(message!.read_at).not.toBeNull()
  })

  it('never answers a tenant automatically: a person is asked instead', async () => {
    const sendsBefore = graph.sends().length
    const body = messageBody('atlas', `wamid.acceptance-tenant-${unique}`, TENANT, 'Where do my customers park?')
    await deliver(body)
    await processed(body)
    const [inbound] = await waitFor('the tenant message recorded', async () => {
      const rows = await communication('atlas', `wamid.acceptance-tenant-${unique}`)
      return rows.length === 1 ? rows : null
    })
    const run = await waitFor("the agent's run on the tenant message", async () => {
      const rows = check(await serviceRole().from('whatsapp_agent_runs').select('*').eq('communication_id', inbound!.id), 'Read the run') as { status: string; outcome: string; suggested_reply: string | null }[]
      return rows[0]?.status === 'completed' ? rows[0] : null
    })
    expect(run.outcome).toBe('handed_over')
    expect(run.suggested_reply).toBe(KNOWLEDGE.atlas.faq.answer)

    const thread = await unwrap(adminOf('atlas').GET('/api/v1/whatsapp/conversations/{conversationId}', { params: { path: { conversationId: inbound!.conversation_id } } }))
    expect(thread.contact).toMatchObject({ tenantId: companies.atlas.tenantId })
    expect(thread.handover).toMatchObject({ requestedBy: 'agent', status: 'open' })
    expect(thread.messages.map((m) => [m.direction, m.recipientType])).toEqual([['inbound', 'tenant']])
    expect(thread.agentRuns[0]).toMatchObject({ outcome: 'handed_over', suggestedReply: KNOWLEDGE.atlas.faq.answer })
    // Nothing was sent to the tenant, now or later; Atlas's handover contact was told.
    await new Promise((resolve) => setTimeout(resolve, 1500))
    expect(graph.sends().length).toBe(sendsBefore)
    expect(graph.sends().filter((s) => JSON.stringify(s.body).includes(TENANT))).toEqual([])
    const notifications = check(
      await signedIn('atlas').from('notifications').select('title, company_id').like('dedupe_key', 'whatsapp-handover:%'),
      "Read Atlas's admin's notifications",
    ) as { title: string; company_id: string }[]
    expect(notifications).toContainEqual({ title: 'WhatsApp conversation needs a person', company_id: companies.atlas.id })
  })

  it('gave the model one prompt per message across the whole scenario, each with one company’s information only', () => {
    // Contact → Atlas, contact → Baobab (answered), contact → Baobab (handed over), tenant → Atlas: four messages,
    // four prompts, whatever Meta retried.
    expect(llm.prompts).toHaveLength(4)
    for (const prompt of llm.prompts) {
      const text = JSON.stringify(prompt)
      const owners = BUSINESSES.filter((b) => text.includes(KNOWLEDGE[b].faq.answer) && text.includes(KNOWLEDGE[b].entry.content))
      expect(owners).toHaveLength(1)
      const theirs = other(owners[0]!)
      for (const leak of [KNOWLEDGE[theirs].faq.answer, KNOWLEDGE[theirs].entry.content, KNOWLEDGE[theirs].draft.answer, theirs === 'atlas' ? 'Atlas' : 'Baobab']) {
        expect(text).not.toContain(leak)
      }
      expect(text).not.toContain(KNOWLEDGE[owners[0]!].draft.answer)
    }
  })

  it("neither company's admin can see the other's contacts, conversations, messages, knowledge or agent runs through the API", async () => {
    for (const business of BUSINESSES) {
      const own = adminOf(business)
      const theirs = other(business)
      const inbox = await unwrap(own.GET('/api/v1/whatsapp/conversations'))
      expect(inbox.items.length).toBeGreaterThan(0)
      expect(new Set(inbox.items.map((c) => c.companyId))).toEqual(new Set([companies[business].id]))
      expect(new Set(inbox.items.map((c) => c.numberId))).toEqual(new Set([companies[business].numberId]))

      for (const conversation of inbox.items) {
        const thread = await unwrap(own.GET('/api/v1/whatsapp/conversations/{conversationId}', { params: { path: { conversationId: conversation.id } } }))
        const text = JSON.stringify(thread)
        expect(text).not.toContain(KNOWLEDGE[theirs].faq.answer)
        expect(text).not.toContain(companies[theirs].id)
        for (const run of thread.agentRuns) expect(run).toMatchObject({ companyId: companies[business].id })
      }
      const faqs = await unwrap(own.GET('/api/v1/whatsapp/agent/faqs'))
      const entries = await unwrap(own.GET('/api/v1/whatsapp/agent/knowledge-entries'))
      expect(JSON.stringify([faqs, entries])).not.toContain(KNOWLEDGE[theirs].faq.answer)
      expect(new Set([...faqs, ...entries].map((k) => k.companyId))).toEqual(new Set([companies[business].id]))

      // The other company's records are not found under one's own company…
      const theirInbox = await unwrap(adminOf(theirs).GET('/api/v1/whatsapp/conversations'))
      const call = own.GET('/api/v1/whatsapp/conversations/{conversationId}', { params: { path: { conversationId: theirInbox.items[0]!.id } } })
      expect((await apiErrorOf(unwrap(call))).status).toBe(404)
      const theirFaq = (await unwrap(adminOf(theirs).GET('/api/v1/whatsapp/agent/faqs')))[0]!
      const withdraw = own.POST('/api/v1/whatsapp/agent/faqs/{faqId}/withdraw', { params: { path: { faqId: theirFaq.id } } })
      expect((await apiErrorOf(unwrap(withdraw))).status).toBe(404)
      // …and naming the other company is refused outright.
      const asOther = adminOf(business, theirs)
      // Called one at a time (a call made before its refusal is awaited would be an unhandled rejection).
      const refused: (() => Promise<unknown>)[] = [
        () => unwrap(asOther.GET('/api/v1/whatsapp/conversations')),
        () => unwrap(asOther.GET('/api/v1/whatsapp/agent/faqs')),
        () => unwrap(asOther.GET('/api/v1/whatsapp/agent/knowledge-entries')),
        () => unwrap(asOther.GET('/api/v1/whatsapp/agent')),
        () => unwrap(asOther.GET('/api/v1/integrations/whatsapp/business-accounts')),
      ]
      for (const call of refused) expect((await apiErrorOf(call())).status).toBe(403)
    }
  })

  it("neither company's admin can read or write the other's rows directly in the database with their own sign-in", async () => {
    const tables = [
      'whatsapp_contacts',
      'whatsapp_conversations',
      'communications',
      'whatsapp_knowledge_faqs',
      'whatsapp_knowledge_entries',
      'whatsapp_agent_configs',
      'whatsapp_agent_runs',
      'whatsapp_handovers',
      'whatsapp_phone_numbers',
      'whatsapp_business_accounts',
      'whatsapp_message_templates',
      'whatsapp_test_messages',
    ] as const
    for (const business of BUSINESSES) {
      const db = signedIn(business)
      const ownId = companies[business].id
      const theirId = companies[other(business)].id
      for (const table of tables) {
        const visible = check(await db.from(table).select('company_id'), `Read ${table} as ${business}`) as { company_id: string }[]
        // Every company table the scenario wrote holds rows of the admin's own company, and only those.
        expect(visible.length, `${table} visible to ${business}`).toBeGreaterThan(0)
        expect(new Set(visible.map((r) => r.company_id)), table).toEqual(new Set([ownId]))
        const theirs = check(await db.from(table).select('company_id').eq('company_id', theirId), `Read ${table} of the other company`)
        expect(theirs, table).toEqual([])
      }
      // Raw webhook payloads (message text and numbers of every company) are closed to every member.
      const raw = await db.from('whatsapp_webhook_events').select('id').limit(1)
      expect(raw.error?.code ?? (raw.data?.length === 0 ? 'empty' : 'visible')).toMatch(/^(42501|empty)$/)
      // Writing into the other company is refused.
      const write = await db.from('whatsapp_knowledge_faqs').insert({ company_id: theirId, question: 'Injected?', answer: 'Injected answer' }).select('id')
      expect(write.error?.code).toBe('42501')
      const runs = await db.from('whatsapp_agent_runs').update({ outcome: 'replied' }).eq('company_id', theirId).select('id')
      expect(runs.error?.code ?? (runs.data?.length === 0 ? 'nothing' : 'changed')).toMatch(/^(42501|nothing)$/)
    }
  })
})
