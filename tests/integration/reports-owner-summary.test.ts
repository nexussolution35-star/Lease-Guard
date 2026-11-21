import { unwrap } from '@leaseguard/api-client'
import type { OwnerSummaryDeliveryJob } from '@leaseguard/domain'
import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { ServiceRoleClientFactory } from '../../backend/src/infrastructure/database/service-role-client.factory.ts'
import { checkOutbound } from '../../backend/src/messaging/outbound-gate.ts'
import type { ProcessorRuntime } from '../../backend/src/workers/jobs/processor-runtime.ts'
import { OwnerSummaryDeliveryProcessor } from '../../backend/src/workers/messaging/owner-summary-delivery.processor.ts'
import type { WorkerQueues } from '../../backend/src/workers/queues/worker-queues.ts'
import { ArrearsReportDataService } from '../../services/reports/src/reports/arrears-report-data.service.ts'
import { saToday } from '../../services/reports/src/reports/as-of.ts'
import { MonitoringReportDataService } from '../../services/reports/src/reports/monitoring-report-data.service.ts'
import { OwnerSummaryDataService } from '../../services/reports/src/reports/owner-summary-data.service.ts'
import { OwnerSummaryService } from '../../services/reports/src/reports/owner-summary.service.ts'
import { ReportDataService } from '../../services/reports/src/reports/report-data.service.ts'
import { SecurityReportDataService } from '../../services/reports/src/reports/security-report-data.service.ts'
import { runCompanyOwnerSummaries } from '../../services/reports/src/worker/owner-summary-run.ts'
import { SupabaseOwnerSummaryStore } from '../../services/reports/src/worker/owner-summary-store.ts'
import { apiErrorOf, check, expectOk, gatewayAs, integration, serviceRole, world } from './support/clients.ts'

/**
 * The weekly owner summary (ticket R-07) on the local stack. The Reports page previews each owner's summary through the
 * gateway (company admins only, the caller's RLS), with every figure equal to the reports for the owner's properties.
 * The reports worker's run (its real summary service and store, the service role) stores each summary and hands it to
 * the core messaging pipeline; the core's processor records it as an approved owner_weekly_summary, once per owner and
 * week, that the outbound gate would deliver. Nothing is sent without an approved template and a connected number,
 * and never to a tenant. The core's own queue is replaced by a recorder here: nothing reaches Meta.
 */

const RUN = integration().runId
const PHONE = `pn-owner-summary-${RUN}`
let createdNumber = false
let templateId: string

const summaryOf = (user: 'admin' | 'manager' | 'readOnly' | 'owner' = 'admin', company: 'a' | 'b' = 'a', query = {}) =>
  unwrap(gatewayAs(user, company).GET('/api/v1/reports/owner_weekly_summary', { params: { query } }))

/** The reports worker's summary service, built by hand as its module wires it. */
function summaries(): OwnerSummaryService {
  const data = new ReportDataService()
  return new OwnerSummaryService(new OwnerSummaryDataService(data), new ArrearsReportDataService(data), new MonitoringReportDataService(), new SecurityReportDataService(data))
}

/** One run of company A's week by the reports worker; the hand-overs are recorded instead of queued. */
async function workerRun(): Promise<{ result: Awaited<ReturnType<typeof runCompanyOwnerSummaries>>; requested: OwnerSummaryDeliveryJob[] }> {
  const db = serviceRole() as unknown as SupabaseClient
  const requested: OwnerSummaryDeliveryJob[] = []
  const result = await runCompanyOwnerSummaries(
    {
      compute: (companyId, asOf) => summaries().compute(db, companyId, asOf),
      store: new SupabaseOwnerSummaryStore(() => db),
      delivery: { request: async (job) => void requested.push(job) },
    },
    { companyId: world().companies.a.id, asOf: saToday(new Date()) },
  )
  return { result, requested }
}

/** The core worker's processor with the service role, its message-delivery queue replaced by a recorder. */
function coreProcessor(): { processor: OwnerSummaryDeliveryProcessor; queued: unknown[] } {
  const queued: unknown[] = []
  const queues = { enqueueAll: async (_queue: string, payloads: unknown[]) => void queued.push(...payloads) } as unknown as WorkerQueues
  const clients = { get: () => serviceRole() } as unknown as ServiceRoleClientFactory
  return { processor: new OwnerSummaryDeliveryProcessor({ start: () => undefined } as unknown as ProcessorRuntime, clients, queues), queued }
}

async function ownerMessages(): Promise<{ id: string; recipient_type: string; status: string; counterparty_number: string; template_id: string | null }[]> {
  return check(
    await serviceRole()
      .from('communications')
      .select('id, recipient_type, status, counterparty_number, template_id')
      .eq('company_id', world().companies.a.id)
      .eq('message_type', 'owner_weekly_summary')
      .not('owner_summary_week', 'is', null),
    'Read the owner summary messages',
  ) as { id: string; recipient_type: string; status: string; counterparty_number: string; template_id: string | null }[]
}

beforeAll(async () => {
  const a = world().companies.a.id
  // Start without an owner summary template, whatever earlier files left.
  expectOk(await serviceRole().from('message_type_templates').delete().eq('company_id', a).eq('message_type', 'owner_weekly_summary'), 'Clear the mapping')
})

afterAll(async () => {
  const db = serviceRole()
  const a = world().companies.a.id
  // Approvals cascade with their communication.
  expectOk(await db.from('communications').delete().eq('company_id', a).not('owner_summary_week', 'is', null), 'Delete the owner summary messages')
  // The stored summaries are the reports worker's history (nobody deletes them); they go with the world.
  expectOk(await db.from('message_type_templates').delete().eq('company_id', a).eq('message_type', 'owner_weekly_summary'), 'Delete the mapping')
  if (templateId) expectOk(await db.from('message_templates').delete().eq('id', templateId), 'Delete the template')
  if (createdNumber) expectOk(await db.from('whatsapp_phone_numbers').delete().eq('phone_number_id', PHONE), 'Delete the number')
})

describe('GET /api/v1/reports/owner_weekly_summary', () => {
  it('previews each owner’s summary, with figures equal to the reports for the owner’s properties', async () => {
    const report = await summaryOf()
    expect(report.reportId).toBe('owner_weekly_summary')
    const owner = report.data.owners.find((o) => o.summary.ownerUserId === world().users.owner.id)
    expect(owner, 'the owner of company A’s properties').toBeDefined()
    if (!owner) return
    expect(owner.summary.ownerName).toBe('Olwethu Owner')
    const propertyId = owner.summary.properties.map((p) => p.propertyId)
    expect(propertyId.sort()).toEqual(world().companies.a.properties.map((p) => p.id).sort())

    const [arrears, monitoring] = await Promise.all([
      unwrap(gatewayAs('admin', 'a').GET('/api/v1/reports/arrears', { params: { query: { propertyId } } })),
      unwrap(gatewayAs('admin', 'a').GET('/api/v1/reports/lease_monitoring', { params: { query: { propertyId } } })),
    ])
    expect(owner.summary.totalOutstanding).toBe(arrears.data.totalOutstanding)
    expect(owner.summary.tenantsInArrears).toBe(arrears.data.tenantCount)
    expect(owner.summary.openEventCount).toBe(monitoring.data.open)
    expect(owner.values[0]).toBe('Olwethu Owner')
    expect(owner.values[2]).toContain('Outstanding R')
  })

  it('says why nothing is sent without an approved template', async () => {
    const report = await summaryOf()
    expect(report.data.blockers.some((b) => b.includes('No template chosen'))).toBe(true)
    expect(report.data.template).toBeUndefined()
    expect(report.data.owners.every((o) => o.message === undefined && o.blockers.length > 0)).toBe(true)
  })

  it('is for company admins only, and never another company’s', async () => {
    for (const user of ['manager', 'readOnly', 'owner'] as const) {
      expect((await apiErrorOf(summaryOf(user))).status, user).toBe(403)
    }
    expect((await apiErrorOf(summaryOf('admin', 'b'))).status).toBe(403)
  })
})

describe('the weekly run', () => {
  it('stores a blocked summary and sends nothing without an approved template', async () => {
    const { result, requested } = await workerRun()
    expect(result.handedOver).toBe(0)
    expect(result.blocked).toBeGreaterThan(0)
    expect(requested).toEqual([])
    const owner = (await summaryOf()).data.owners.find((o) => o.summary.ownerUserId === world().users.owner.id)
    expect(owner?.delivery).toMatchObject({ status: 'blocked', blockers: expect.arrayContaining([expect.stringContaining('No template chosen')]) })
    expect(await ownerMessages()).toEqual([])
  })

  it('hands the summary over once the template is chosen and a number is connected, and the core records it for the owner only', async () => {
    const db = serviceRole()
    const a = world().companies.a.id
    const connected = check(await db.from('whatsapp_phone_numbers').select('id').eq('company_id', a).eq('connection_status', 'connected'), 'Read numbers')
    if ((connected as unknown[]).length === 0) {
      expectOk(
        await db.from('whatsapp_phone_numbers').insert({
          company_id: a,
          business_account_id: `waba-owner-summary-${RUN}`,
          phone_number_id: PHONE,
          display_name: 'Integration owner summaries',
          display_number: '+27 11 555 0199',
          connection_status: 'connected',
        }),
        'Connect company A',
      )
      createdNumber = true
    }
    const template = check(
      await db
        .from('message_templates')
        .insert({
          company_id: a,
          name: 'Owner weekly summary',
          message_type: 'owner_weekly_summary',
          audience: 'property_owner',
          meta_template_name: `owner_weekly_${RUN}`,
          language: 'en_ZA',
          category: 'utility',
          body: 'Good morning {{1}}. Your LeaseGuard summary for the week of {{2}}: {{3}}.',
          variables: ['Owner name', 'Week', 'Summary'],
          approval_status: 'approved',
        })
        .select('id')
        .single(),
      'Insert the approved owner template',
    ) as { id: string }
    templateId = template.id
    expectOk(await db.from('message_type_templates').insert({ company_id: a, message_type: 'owner_weekly_summary', message_template_id: template.id }), 'Choose it')

    const preview = (await summaryOf()).data
    expect(preview.blockers).toEqual([])
    const owner = preview.owners.find((o) => o.summary.ownerUserId === world().users.owner.id)
    expect(owner?.message).toBe(`Good morning Olwethu Owner. Your LeaseGuard summary for the week of ${owner?.values[1]}: ${owner?.values[2]}.`)

    const { result, requested } = await workerRun()
    expect(result.handedOver).toBeGreaterThan(0)
    const mine = requested.filter(Boolean)
    expect(mine.length).toBe(result.handedOver)

    const { processor, queued } = coreProcessor()
    for (const job of mine) expect((await processor.run(job)).outcome).toBe('queued')
    const messages = await ownerMessages()
    expect(messages.length).toBe(mine.length)
    for (const message of messages) {
      expect(message).toMatchObject({ recipient_type: 'property_owner', status: 'approved', template_id: template.id })
      expect(message.counterparty_number).not.toBe(world().companies.a.tenants[0]?.whatsappNumber)
      const approvals = check(await db.from('message_approvals').select('decision, approved_by_schedule, decided_by_user_id').eq('communication_id', message.id), 'Read approval')
      expect(approvals).toEqual([{ decision: 'approved', approved_by_schedule: true, decided_by_user_id: null }])
      // The message-delivery job would find it deliverable: the gate passes the schedule's approval.
      const verdict = await checkOutbound(db as never, { companyId: a, communicationId: message.id }, saToday(new Date()))
      expect(verdict.deliverable ? [] : verdict.blockers).toEqual([])
    }
    expect(queued).toEqual(messages.map((m) => ({ companyId: a, communicationId: m.id })))
    const ownerMessage = messages.find(() => true)
    expect(ownerMessage?.counterparty_number).toBe('+27820000104')

    const after = (await summaryOf()).data.owners.find((o) => o.summary.ownerUserId === world().users.owner.id)
    expect(after?.delivery).toMatchObject({ status: 'handed_over', deliveryStatus: 'approved', communicationId: ownerMessage?.id })
  })

  it('sends at most once per owner and week', async () => {
    const before = await ownerMessages()
    const { result, requested } = await workerRun()
    expect(result.handedOver).toBe(0)
    expect(result.alreadyHandedOver).toBeGreaterThan(0)
    expect(requested).toEqual([])
    // A repeated hand-over of the same summary records nothing new.
    const stored = check(await serviceRole().from('reports_owner_summaries').select('id').eq('company_id', world().companies.a.id).eq('status', 'handed_over'), 'Read stored')
    const { processor } = coreProcessor()
    for (const row of stored as { id: string }[]) {
      await expect(processor.run({ companyId: world().companies.a.id, summaryId: row.id })).resolves.toMatchObject({ outcome: 'queued', recorded: 'existing' })
    }
    expect((await ownerMessages()).map((m) => m.id).sort()).toEqual(before.map((m) => m.id).sort())
  })
})
