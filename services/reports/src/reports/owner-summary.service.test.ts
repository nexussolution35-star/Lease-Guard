import type { DbClient } from '@leaseguard/service-kit'
import { describe, expect, it } from 'vitest'

import { ArrearsReportDataService } from './arrears-report-data.service'
import { MonitoringReportDataService } from './monitoring-report-data.service'
import { OwnerSummaryDataService } from './owner-summary-data.service'
import { OwnerSummaryService } from './owner-summary.service'
import { ReportDataService } from './report-data.service'
import { SecurityReportDataService } from './security-report-data.service'

const COMPANY = '1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d'
// Monday 23 Nov 2026, 09:00 in Johannesburg.
const NOW = new Date('2026-11-23T07:00:00Z')
const OWNER = '6f0c8e9a-6a43-4a8e-9d1f-2b7c1f1c0a05'

const ROWS: Record<string, unknown[]> = {
  reports_owner_summary_owners: [
    {
      owner_user_id: OWNER,
      owner_name: 'Pieter Botha',
      owner_status: 'active',
      owner_role: 'property_owner',
      whatsapp_number: '+27825501194',
      properties: [{ propertyId: 'p1', propertyName: 'Maponya Square' }],
    },
    // An owner without a WhatsApp number at another property.
    {
      owner_user_id: 'o2',
      owner_name: 'Zanele Khumalo',
      owner_status: 'active',
      owner_role: 'property_owner',
      whatsapp_number: null,
      properties: [{ propertyId: 'p2', propertyName: 'Brooklyn Mall' }],
    },
  ],
  reports_owner_summary_channel: [
    {
      owner_summary_weekday: 'monday',
      whatsapp_connected: true,
      template_id: 'tpl-1',
      meta_template_name: 'owner_weekly',
      language: 'en_ZA',
      category: 'utility',
      body: 'Hi {{1}}, week of {{2}}: {{3}}',
      variables: ['Owner name', 'Week', 'Summary'],
      approval_status: 'approved',
      supports_document_attachment: false,
      mapped_at: '2026-11-20T08:00:00Z',
      meta_template_id: 'wt-1',
      meta_status: 'APPROVED',
      meta_rejected_reason: null,
      meta_body: 'Hi {{1}}, week of {{2}}: {{3}}',
    },
  ],
  reports_owner_summaries_stored: [
    {
      owner_user_id: OWNER,
      summary_id: 'sum-1',
      status: 'handed_over',
      blockers: [],
      computed_at: '2026-11-23T05:00:00Z',
      communication_id: 'msg-1',
      delivery_status: 'delivered',
      failure_reason: null,
      sent_at: '2026-11-23T05:00:05Z',
      previous_week_start: '2026-11-16',
      previous_total_outstanding: '10000.00',
    },
  ],
  reports_arrears_detail: [
    {
      tenant_id: 't1', tenant_name: 'Dlamini Cellular', property_id: 'p1', property_name: 'Maponya Square', unit_id: 'u1', unit_number: 'S01',
      lease_id: 'l1', lease_reference: 'MSQ-L001', statement_id: 's1', statement_date: '2026-10-31', outstanding: '12960.00',
    },
    {
      tenant_id: 't2', tenant_name: 'Fresh Mart', property_id: 'p2', property_name: 'Brooklyn Mall', unit_id: null, unit_number: null,
      lease_id: null, lease_reference: null, statement_id: 's2', statement_date: '2026-10-31', outstanding: '500.00',
    },
  ],
  reports_guarantee_notice_days: [{ company_notice_days: [90, 30], rule_notice_days: null }],
}

function dbAnswering(rows: Record<string, unknown[]>) {
  const calls: { fn: string; args: Record<string, unknown> }[] = []
  const db = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args })
      return { data: rows[fn] ?? [], error: null }
    },
  } as unknown as DbClient
  return { db, calls }
}

function service(): OwnerSummaryService {
  const data = new ReportDataService()
  return new OwnerSummaryService(new OwnerSummaryDataService(data), new ArrearsReportDataService(data), new MonitoringReportDataService(), new SecurityReportDataService(data))
}

describe('OwnerSummaryService', () => {
  it('previews every owner’s summary for the week, with the change since the stored one and its delivery', async () => {
    const { db, calls } = dbAnswering(ROWS)
    const envelope = await service().report(db, COMPANY, {}, NOW)

    expect(envelope).toMatchObject({ reportId: 'owner_weekly_summary', asOf: '2026-11-23', filters: {} })
    expect(envelope.data).toMatchObject({
      weekStart: '2026-11-23',
      sendWeekday: 'monday',
      nextSendOn: '2026-11-23',
      blockers: [],
      template: { metaTemplateName: 'owner_weekly', sendable: true },
    })
    const [pieter, zanele] = envelope.data.owners
    expect(pieter?.summary).toMatchObject({ ownerName: 'Pieter Botha', totalOutstanding: 12960, outstandingChange: 2960, previous: { weekStart: '2026-11-16', totalOutstanding: 10000 } })
    expect(pieter?.message).toBe(`Hi Pieter Botha, week of 23 Nov 2026: ${pieter?.values[2]}`)
    expect(pieter?.values[2]).toContain('up R 2 960,00 since 16 Nov 2026')
    expect(pieter?.blockers).toEqual([])
    expect(pieter?.delivery).toMatchObject({ summaryId: 'sum-1', status: 'handed_over', communicationId: 'msg-1', deliveryStatus: 'delivered' })

    // Each owner sees only their own properties; the one without a number is told why.
    expect(zanele?.summary).toMatchObject({ totalOutstanding: 500, previous: null, outstandingChange: null })
    expect(zanele?.blockers).toEqual(['Owner has no WhatsApp number on record'])
    expect(zanele?.delivery).toBeUndefined()

    expect(calls.find((call) => call.fn === 'reports_owner_summaries_stored')?.args).toEqual({ p_company_id: COMPANY, p_week_start: '2026-11-23' })
    expect(calls.every((call) => call.args.p_company_id === COMPANY)).toBe(true)
  })

  it('keeps the owners of the filtered properties', async () => {
    const { db } = dbAnswering(ROWS)
    const envelope = await service().report(db, COMPANY, { propertyId: ['p2'] }, NOW)
    expect(envelope.data.owners.map((owner) => owner.summary.ownerName)).toEqual(['Zanele Khumalo'])
  })

  it('says why nothing is sent without an approved template or a connected number', async () => {
    const channel = { ...(ROWS.reports_owner_summary_channel?.[0] as object), whatsapp_connected: false, approval_status: 'submitted', meta_status: 'PENDING' }
    const { db } = dbAnswering({ ...ROWS, reports_owner_summary_channel: [channel] })
    const envelope = await service().report(db, COMPANY, {}, NOW)
    expect(envelope.data.blockers).toEqual([expect.stringContaining('Meta is reviewing'), expect.stringContaining('No WhatsApp number is connected')])
    expect(envelope.data.owners[0]?.blockers).toEqual(envelope.data.blockers)
    expect(envelope.data.template).toMatchObject({ sendable: false })
  })

  it('shows no WhatsApp text while no template is chosen', async () => {
    const channel = { owner_summary_weekday: 'friday', whatsapp_connected: true, template_id: null, meta_template_name: null, language: null, category: null, body: null,
      variables: null, approval_status: null, supports_document_attachment: null, mapped_at: null, meta_template_id: null, meta_status: null,
      meta_rejected_reason: null, meta_body: null }
    const { db } = dbAnswering({ ...ROWS, reports_owner_summary_channel: [channel] })
    const envelope = await service().report(db, COMPANY, {}, NOW)
    expect(envelope.data.template).toBeUndefined()
    expect(envelope.data.nextSendOn).toBe('2026-11-27')
    expect(envelope.data.owners[0]?.message).toBeUndefined()
    expect(envelope.data.blockers[0]).toContain('No template chosen')
  })
})
