import { createHash, randomUUID } from 'node:crypto'

import { unwrap } from '@leaseguard/api-client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { localSql } from '../fixtures/local-db.ts'
import { apiAs, apiErrorOf, check, expectOk, gatewayAs, integration, serviceRole, world } from './support/clients.ts'

/**
 * Statement processing and communication activity (ticket R-06) on the local stack, through the gateway like the web
 * app: the reports service computes them from the reporting functions under the caller's RLS, and every figure equals
 * the Statements page's, the dashboard's and communication analytics' (the core API) for the same data, for every
 * member role, never across companies. Nothing here sends or approves a message.
 */

type User = 'admin' | 'manager' | 'readOnly' | 'owner'

const statementsOf = (company: 'a' | 'b', user: User = 'manager', query = {}) =>
  unwrap(gatewayAs(user, company).GET('/api/v1/reports/statement_processing', { params: { query } }))
const communicationsOf = (company: 'a' | 'b', user: User = 'manager', query = {}) =>
  unwrap(gatewayAs(user, company).GET('/api/v1/reports/communication_activity', { params: { query } }))
const dashboardOf = (company: 'a' | 'b') => unwrap(apiAs('manager', company).GET('/api/v1/dashboard/summary'))

const statementIds: string[] = []
const communicationIds: string[] = []
let reviewId: string
let failedId: string
let pendingId: string
let failedMessageId: string

async function insertStatement(fields: Record<string, unknown>): Promise<string> {
  const company = world().companies.a
  const property = company.properties[0]
  if (!property) throw new Error('company A has no property')
  const seed = randomUUID()
  const row = check(
    await serviceRole()
      .from('statements')
      .insert({
        company_id: company.id,
        property_id: property.id,
        file_name: `it-r06-${seed}.pdf`,
        storage_path: `${company.id}/${seed}/it-r06.pdf`,
        mime_type: 'application/pdf',
        size_bytes: 1024,
        file_sha256: createHash('sha256').update(`${integration().runId}:r06:${seed}`).digest('hex'),
        source_system: 'PropSys',
        uploaded_by_user_id: world().users.manager.id,
        ...fields,
      })
      .select('id')
      .single(),
    'Insert statement',
  ) as { id: string }
  statementIds.push(row.id)
  return row.id
}

async function insertMessage(fields: Record<string, unknown>): Promise<string> {
  const company = world().companies.a
  const tenant = company.tenants[0]
  if (!tenant) throw new Error('company A has no tenant')
  const row = check(
    await serviceRole()
      .from('communications')
      .insert({
        company_id: company.id,
        channel: 'whatsapp',
        direction: 'outbound',
        recipient_type: 'tenant',
        tenant_id: tenant.id,
        counterparty_number: tenant.whatsappNumber,
        company_number: '+27 11 555 0100',
        body: `Good day. Your account is overdue. (LeaseGuard integration test ${integration().runId})`,
        created_by_user_id: world().users.manager.id,
        ...fields,
      })
      .select('id')
      .single(),
    'Insert message',
  ) as { id: string }
  communicationIds.push(row.id)
  return row.id
}

/** An outbound owner summary already in a delivery state, inserted as the database owner (local stack only). */
async function insertOwnerMessage(fields: Record<string, string>): Promise<string> {
  const owner = world().users.owner
  const row = {
    company_id: world().companies.a.id,
    channel: 'whatsapp',
    direction: 'outbound',
    message_type: 'owner_weekly_summary',
    recipient_type: 'property_owner',
    owner_user_id: owner.id,
    counterparty_number: owner.whatsappNumber,
    company_number: '+27115550100',
    body: `Weekly summary (LeaseGuard integration test ${integration().runId})`,
    ...fields,
  }
  const columns = Object.keys(row).join(', ')
  const json = JSON.stringify([row]).replaceAll("'", "''")
  const [inserted] = (await localSql(
    `insert into public.communications (${columns}) select ${columns} from jsonb_populate_recordset(null::public.communications, '${json}'::jsonb) returning id`,
  )) as { id: string }[]
  if (!inserted) throw new Error('Insert owner message returned nothing')
  communicationIds.push(inserted.id)
  return inserted.id
}

beforeAll(async () => {
  reviewId = await insertStatement({ status: 'review_required' })
  failedId = await insertStatement({ status: 'review_required', processing_error: 'The PDF could not be read' })
  await insertStatement({ status: 'uploaded' })

  pendingId = await insertMessage({ message_type: 'overdue_payment_reminder', status: 'pending_approval' })
  expectOk(
    await serviceRole()
      .from('message_approvals')
      .insert({ company_id: world().companies.a.id, communication_id: pendingId, requested_by_user_id: world().users.manager.id }),
    'Request approval',
  )
  // Delivery states are recorded by the communication lifecycle, so these are written as the database owner (local
  // stack only), as owner summaries (no approval needed).
  failedMessageId = await insertOwnerMessage({ status: 'failed', failure_reason: 'Number not on WhatsApp' })
  await insertOwnerMessage({ status: 'delivered', sent_at: new Date().toISOString(), delivered_at: new Date().toISOString() })
})

afterAll(async () => {
  const db = serviceRole()
  // Approval requests cascade with their communication.
  if (communicationIds.length > 0) expectOk(await db.from('communications').delete().in('id', communicationIds), 'Delete messages')
  if (statementIds.length > 0) expectOk(await db.from('statements').delete().in('id', statementIds), 'Delete statements')
})

describe('GET /api/v1/reports/statement_processing', () => {
  it('counts the statements waiting for review as the dashboard and the Statements page do, in both companies', async () => {
    for (const company of ['a', 'b'] as const) {
      const [report, dashboard, listed] = await Promise.all([
        statementsOf(company),
        dashboardOf(company),
        unwrap(apiAs('manager', company).GET('/api/v1/statements', { params: { query: { status: 'review_required', pageSize: 1 } } })),
      ])
      expect(report.reportId).toBe('statement_processing')
      expect(report.asOf).toBe(dashboard.asOf)
      expect(report.data.pendingReview, company).toBe(dashboard.pendingStatementReviews)
      expect(report.data.pendingReview, company).toBe(listed.total)
      expect(report.data.backlog).toHaveLength(report.data.pendingReview)
      // The groups add up to the totals, so the CSV of the rows agrees with the strip above it.
      expect(report.data.bySource.reduce((total, group) => total + group.total, 0)).toBe(report.data.total)
      expect(report.data.byProperty.reduce((total, group) => total + group.total, 0)).toBe(report.data.rows.length)
    }
  })

  it('lists the backlog oldest first and the processing failure with its reason', async () => {
    const report = await statementsOf('a')
    const backlogIds = report.data.backlog.map((row) => row.statementId)
    expect(backlogIds).toEqual(expect.arrayContaining([reviewId, failedId]))
    expect(backlogIds.indexOf(reviewId)).toBeLessThan(backlogIds.indexOf(failedId))
    expect(report.data.failures.map((row) => [row.statementId, row.processingError])).toContainEqual([failedId, 'The PDF could not be read'])
    expect(report.data.bySource.find((group) => group.sourceSystem === 'PropSys')).toMatchObject({ pendingReview: 2, processingFailures: 1, inProgress: 1 })
  })

  it('narrows to statuses and upload dates and states the filters back', async () => {
    const today = (await statementsOf('a')).asOf
    const report = await statementsOf('a', 'manager', { status: ['uploaded'], from: today })
    expect(report.filters).toEqual({ from: today, statuses: ['uploaded'] })
    expect(report.data.rows.length).toBeGreaterThan(0)
    expect(report.data.rows.every((row) => row.status === 'uploaded' && row.uploadedOn >= today)).toBe(true)
    expect((await apiErrorOf(statementsOf('a', 'manager', { status: ['delivered'] }))).status).toBe(400)
  })
})

describe('GET /api/v1/reports/communication_activity', () => {
  it('counts the messages awaiting approval as the dashboard does, in both companies', async () => {
    for (const company of ['a', 'b'] as const) {
      const [report, dashboard] = await Promise.all([communicationsOf(company), dashboardOf(company)])
      expect(report.data.approvals.pending, company).toBe(dashboard.pendingApprovals)
      expect(report.data.byType.reduce((total, group) => total + group.total, 0)).toBe(report.data.total)
    }
  })

  it('counts the messages handed over, delivered and failed as communication analytics does for the same days', async () => {
    const asOf = (await communicationsOf('a')).asOf
    const from = new Date(Date.parse(`${asOf}T00:00:00Z`) - 365 * 86_400_000).toISOString().slice(0, 10)
    const [report, analytics] = await Promise.all([
      communicationsOf('a', 'manager', { from, to: asOf }),
      unwrap(apiAs('manager', 'a').GET('/api/v1/communications/analytics', { params: { query: { from, to: asOf } } })),
    ])
    const whatsapp = report.data.rows.filter((row) => row.channel === 'whatsapp')
    expect(whatsapp.filter((row) => row.outcome !== undefined)).toHaveLength(analytics.outbound)
    expect(whatsapp.filter((row) => row.outcome === 'delivered' || row.outcome === 'read')).toHaveLength(analytics.delivered)
    expect(whatsapp.filter((row) => row.outcome === 'failed')).toHaveLength(analytics.failed)
    expect(whatsapp.filter((row) => row.direction === 'inbound')).toHaveLength(analytics.inbound)
  })

  it('lists the pending approval with its age and the failed message with its reason', async () => {
    const report = await communicationsOf('a')
    const pending = report.data.pendingApprovals.find((row) => row.communicationId === pendingId)
    expect(pending).toMatchObject({ messageType: 'overdue_payment_reminder', ageBucket: 'under_1_day' })
    expect(pending?.waitingHours).toBeLessThan(24)
    expect(report.data.failedMessages.map((row) => [row.communicationId, row.failureReason])).toContainEqual([failedMessageId, 'Number not on WhatsApp'])
  })

  it('narrows to delivery statuses', async () => {
    const report = await communicationsOf('a', 'manager', { status: ['failed'] })
    expect(report.filters).toEqual({ statuses: ['failed'] })
    expect(report.data.rows.every((row) => row.status === 'failed')).toBe(true)
  })
})

describe('reports access', () => {
  it('is read-only and the same for every member role of the company', async () => {
    const manager = await statementsOf('a')
    const managerMessages = await communicationsOf('a')
    for (const user of ['admin', 'readOnly', 'owner'] as const) {
      expect((await statementsOf('a', user)).data.total, user).toBe(manager.data.total)
      expect((await communicationsOf('a', user)).data.total, user).toBe(managerMessages.data.total)
    }
    const { gatewayBaseUrl, accessTokens, world: w } = integration()
    const write = await fetch(`${gatewayBaseUrl}/api/v1/reports/communication_activity`, {
      method: 'POST',
      headers: { authorization: `Bearer ${accessTokens.manager}`, 'x-company-id': w.companies.a.id },
    })
    expect(write.status).toBe(404)
  })

  it('never answers for another company', async () => {
    expect((await apiErrorOf(statementsOf('b', 'admin'))).status).toBe(403)
    expect((await apiErrorOf(communicationsOf('b', 'readOnly'))).status).toBe(403)
    const b = await communicationsOf('b')
    expect(b.data.rows.some((row) => communicationIds.includes(row.communicationId))).toBe(false)
    const bStatements = await statementsOf('b')
    expect(bStatements.data.rows.some((row) => statementIds.includes(row.statementId))).toBe(false)
  })
})

