import { unwrap } from '@leaseguard/api-client'
import {
  addDaysISO,
  addMonthsISO,
  crossedThreshold,
  daysBetween,
  expiryBucketFor,
  leasesRequiringRenewalWarning,
  MONITORED_LEASE_STATUSES,
  shouldRaiseExpiryEvent,
  type LeaseStatus,
} from '@leaseguard/domain'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { apiAs, apiErrorOf, check, expectOk, gatewayAs, integration, serviceRole, world } from './support/clients.ts'

/**
 * Lease expiry and renewal deadlines (ticket R-03) on the local stack, through the gateway like the web app: the
 * reports service computes them from the reporting functions under the caller's RLS with the rules lease monitoring
 * uses. The rows equal the company's verified monitored leases in the database, the notice and warning counts equal
 * what monitoring raises with the company's thresholds, an open expiry or renewal event links from its lease and is
 * counted on the dashboard, for every member role and never across companies.
 *
 * This file adds one unit and one verified lease with a renewal option to company A (expiring in about two months,
 * notice one month), and an open event of each kind on it, and removes them afterwards.
 */

const SLOW = 90_000
const OPEN = ['new', 'under_review', 'action_required', 'in_progress']
const reference = `ZR-${integration().runId}`.slice(0, 40).toUpperCase()

let unitId: string | undefined
let leaseId: string | undefined
const eventIds: string[] = []
let asOf = ''

const property = () => world().companies.a.properties[0]!
const tenant = () => world().companies.a.tenants[0]!

type User = 'admin' | 'manager' | 'readOnly' | 'owner'
const expiryOf = (company: 'a' | 'b', user: User = 'manager', query = {}) =>
  unwrap(gatewayAs(user, company).GET('/api/v1/reports/lease_expiry', { params: { query } }))
const renewalsOf = (company: 'a' | 'b', user: User = 'manager', query = {}) =>
  unwrap(gatewayAs(user, company).GET('/api/v1/reports/renewal_deadlines', { params: { query } }))
const dashboardOf = (company: 'a' | 'b') => unwrap(apiAs('manager', company).GET('/api/v1/dashboard/summary'))

interface LeaseRow {
  id: string
  reference: string
  status: LeaseStatus
  verified: boolean
  expiry_date: string
  property_id: string
  renewal_option_exists: boolean
  renewal_exercised: boolean
  renewal_notice_period_months: number | null
}

async function leasesOf(companyId: string): Promise<LeaseRow[]> {
  return check(
    await serviceRole()
      .from('leases')
      .select('id, reference, status, verified, expiry_date, property_id, renewal_option_exists, renewal_exercised, renewal_notice_period_months')
      .eq('company_id', companyId),
    'leases',
  ) as LeaseRow[]
}

/** The thresholds monitoring applies: the rule's own days, else the company's; none when the rule is off. */
async function thresholdsOf(companyId: string): Promise<{ notice: number[] | null; warning: number[] | null }> {
  const db = serviceRole()
  const company = check(await db.from('companies').select('lease_expiry_notice_days, renewal_deadline_warning_days').eq('id', companyId).single(), 'company')
  const rules = check(await db.from('monitoring_rules').select('event_type, enabled, config').eq('company_id', companyId), 'rules') as {
    event_type: string
    enabled: boolean
    config: { noticeDays?: number[]; warningDays?: number[] }
  }[]
  const rule = (type: string) => rules.find((candidate) => candidate.event_type === type)
  const expiry = rule('lease_expiry')
  const renewal = rule('renewal_notice_deadline')
  return {
    notice: expiry ? (expiry.enabled ? (expiry.config.noticeDays ?? company.lease_expiry_notice_days) : null) : company.lease_expiry_notice_days,
    warning: renewal ? (renewal.enabled ? (renewal.config.warningDays ?? company.renewal_deadline_warning_days) : null) : company.renewal_deadline_warning_days,
  }
}

const monitored = (lease: LeaseRow) => lease.verified && MONITORED_LEASE_STATUSES.includes(lease.status)
const renewalOptionOf = (lease: LeaseRow) => ({
  exists: lease.renewal_option_exists,
  exercised: lease.renewal_exercised,
  ...(lease.renewal_notice_period_months !== null ? { noticePeriodMonths: lease.renewal_notice_period_months } : {}),
})

beforeAll(async () => {
  asOf = (await expiryOf('a')).asOf
  const a = world().companies.a
  const db = serviceRole()
  const unit = check(
    await db
      .from('units')
      .insert({ company_id: a.id, property_id: property().id, unit_number: reference.slice(0, 30), type: 'kiosk', floor_area_sqm: 10, occupancy_status: 'vacant' })
      .select('id')
      .single(),
    'Add this file’s unit',
  )
  unitId = unit.id
  const expiry = addDaysISO(asOf, 60)
  const lease = check(
    await db
      .from('leases')
      .insert({
        company_id: a.id,
        reference,
        property_id: property().id,
        unit_id: unit.id,
        tenant_id: tenant().id,
        commencement_date: '2024-03-01',
        expiry_date: expiry,
        initial_monthly_rental: 10_000,
        current_monthly_rental: 10_800,
        payment_due_day: 1,
        escalation_type: 'none',
        escalation_frequency: 'annual',
        first_escalation_date: '2025-03-01',
        renewal_option_exists: true,
        renewal_term_months: 36,
        renewal_notice_period_months: 1,
        status: 'draft',
      })
      .select('id')
      .single(),
    'Add this file’s lease',
  )
  leaseId = lease.id
  // Verified after the terms are in (a term written in the same write as `verified` is never verified).
  expectOk(
    await db
      .from('leases')
      .update({ status: 'active', verified: true, verified_by_user_id: world().users.admin.id, verified_at: new Date().toISOString() })
      .eq('id', lease.id),
    'Verify this file’s lease',
  )
  for (const type of ['lease_expiry', 'renewal_notice_deadline'] as const) {
    const event = check(
      await db
        .from('monitoring_events')
        .insert({
          company_id: a.id,
          type,
          property_id: property().id,
          unit_id: unit.id,
          tenant_id: tenant().id,
          lease_id: lease.id,
          lease_reference: reference,
          title: `${type} of ${reference}`,
          description: `Created by the reports test run ${integration().runId}.`,
          identified_on: asOf,
          due_date: expiry,
          priority: 'high',
          recommended_action: 'Confirm the renewal with the owner.',
          status: 'new',
        })
        .select('id')
        .single(),
      `Add this file’s ${type} event`,
    )
    eventIds.push(event.id)
  }
}, SLOW)

afterAll(async () => {
  const a = world().companies.a.id
  const db = serviceRole()
  if (eventIds.length > 0) expectOk(await db.from('monitoring_events').delete().eq('company_id', a).in('id', eventIds), 'Delete this file’s events')
  if (leaseId) {
    expectOk(await db.from('units').update({ current_lease_id: null, current_tenant_id: null }).eq('company_id', a).eq('current_lease_id', leaseId), 'Release this file’s unit')
    expectOk(await db.from('leases').delete().eq('company_id', a).eq('id', leaseId), 'Delete this file’s lease')
  }
  if (unitId) expectOk(await db.from('units').delete().eq('company_id', a).eq('id', unitId), 'Delete this file’s unit')
}, SLOW)

describe('GET /api/v1/reports/lease_expiry', () => {
  it('lists exactly the verified monitored leases of the database, with days and buckets from the as-at date', async () => {
    for (const company of ['a', 'b'] as const) {
      const companyId = world().companies[company].id
      const [report, leases, thresholds] = await Promise.all([expiryOf(company), leasesOf(companyId), thresholdsOf(companyId)])
      expect(report.reportId).toBe('lease_expiry')
      const expected = leases.filter(monitored)
      expect(report.data.rows.map((row) => row.leaseId).sort(), company).toEqual(expected.map((lease) => lease.id).sort())
      for (const row of report.data.rows) {
        const lease = expected.find((candidate) => candidate.id === row.leaseId)!
        expect(row.expiryDate).toBe(lease.expiry_date)
        expect(row.daysUntilExpiry).toBe(daysBetween(report.asOf, lease.expiry_date))
        expect(row.bucket).toBe(expiryBucketFor(lease.expiry_date, report.asOf))
      }
      // Soonest first, and the buckets add up to the rows.
      expect([...report.data.rows].sort((x, y) => x.expiryDate.localeCompare(y.expiryDate)).map((row) => row.leaseId)).toEqual(report.data.rows.map((row) => row.leaseId))
      expect(report.data.buckets.reduce((total, bucket) => total + bucket.count, 0)).toBe(report.data.rows.length)
      expect(report.data.unverifiedLeasesExcluded, company).toBe(leases.filter((lease) => !lease.verified && !['expired', 'renewed', 'terminated'].includes(lease.status)).length)
      // Within notice: exactly the leases monitoring raises an expiry event for, with the company's thresholds.
      const raised = thresholds.notice === null ? [] : expected.filter((lease) => shouldRaiseExpiryEvent({ expiryDate: lease.expiry_date, status: lease.status }, report.asOf, thresholds.notice!) !== null)
      expect(report.data.withinNoticeCount, company).toBe(raised.length)
    }
  })

  it('shows this file’s lease within 3 months and inside notice, linking to its open expiry event counted on the dashboard', async () => {
    const [report, dashboard, thresholds] = await Promise.all([expiryOf('a'), dashboardOf('a'), thresholdsOf(world().companies.a.id)])
    const row = report.data.rows.find((candidate) => candidate.leaseId === leaseId)
    expect(row).toMatchObject({ reference, bucket: 'months_0_3', daysUntilExpiry: 60, monthlyRental: 10800, renewalOptionAvailable: true, openEventId: eventIds[0] })
    const threshold = thresholds.notice === null ? null : crossedThreshold(60, thresholds.notice)
    expect(row?.noticeThreshold ?? null).toBe(threshold)
    const { count } = await serviceRole()
      .from('monitoring_events')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', world().companies.a.id)
      .eq('type', 'lease_expiry')
      .in('status', OPEN)
    expect(dashboard.upcomingExpiries).toBe(count)
    // Every open expiry event on a reported lease links from its row.
    expect(report.data.rows.filter((candidate) => candidate.openEventId).length).toBeLessThanOrEqual(dashboard.upcomingExpiries)
    expect(report.data.rows.some((candidate) => candidate.openEventId === eventIds[0])).toBe(true)
  })

  it('narrows to the expiry bucket, the expiry date range and the property, and states the filters back', async () => {
    const soon = await expiryOf('a', 'manager', { status: ['months_0_3'] })
    expect(soon.filters).toEqual({ statuses: ['months_0_3'] })
    expect(soon.data.rows.length).toBeGreaterThan(0)
    expect(soon.data.rows.every((row) => row.bucket === 'months_0_3')).toBe(true)

    const expiry = addDaysISO(asOf, 60)
    const ranged = await expiryOf('a', 'manager', { from: expiry, to: expiry })
    expect(ranged.data.rows.map((row) => row.leaseId)).toContain(leaseId)
    expect(ranged.data.rows.every((row) => row.expiryDate === expiry)).toBe(true)

    const other = world().companies.a.properties.find((candidate) => candidate.id !== property().id)!
    const elsewhere = await expiryOf('a', 'manager', { propertyId: [other.id] })
    expect(elsewhere.data.rows.every((row) => row.propertyId === other.id)).toBe(true)
  })

  it('refuses a status it does not offer', async () => {
    expect((await apiErrorOf(expiryOf('a', 'manager', { status: ['vacant'] }))).status).toBe(400)
  })
})

describe('GET /api/v1/reports/renewal_deadlines', () => {
  it('lists the notice deadlines of the verified renewal options, with the warnings monitoring raises', async () => {
    for (const company of ['a', 'b'] as const) {
      const companyId = world().companies[company].id
      const [report, leases, thresholds] = await Promise.all([renewalsOf(company), leasesOf(companyId), thresholdsOf(companyId)])
      const withDeadline = leases.filter((lease) => monitored(lease) && lease.renewal_option_exists && lease.renewal_notice_period_months !== null)
      expect(report.data.rows.map((row) => row.leaseId).sort(), company).toEqual(withDeadline.map((lease) => lease.id).sort())
      for (const row of report.data.rows) {
        const lease = withDeadline.find((candidate) => candidate.id === row.leaseId)!
        expect(row.deadline).toBe(addMonthsISO(lease.expiry_date, -(lease.renewal_notice_period_months ?? 0)))
        expect(row.daysUntilDeadline).toBe(daysBetween(report.asOf, row.deadline))
      }
      const warned =
        thresholds.warning === null
          ? []
          : leasesRequiringRenewalWarning(
              leases.filter(monitored).map((lease) => ({ ...lease, expiryDate: lease.expiry_date, renewalOption: renewalOptionOf(lease) })),
              report.asOf,
              thresholds.warning,
            )
      expect(report.data.requiringWarning, company).toBe(warned.length)
    }
  })

  it('shows this file’s deadline one month before expiry with the days left, linking to its open renewal event', async () => {
    const report = await renewalsOf('a')
    const deadline = addMonthsISO(addDaysISO(asOf, 60), -1)
    expect(report.data.rows.find((row) => row.leaseId === leaseId)).toMatchObject({
      reference,
      noticePeriodMonths: 1,
      deadline,
      daysUntilDeadline: daysBetween(asOf, deadline),
      openEventId: eventIds[1],
    })
    const statuses = await renewalsOf('a', 'manager', { status: ['passed'] })
    expect(statuses.data.rows.every((row) => row.status === 'passed')).toBe(true)
    expect((await apiErrorOf(renewalsOf('a', 'manager', { status: ['not_applicable'] }))).status).toBe(400)
  })
})

describe('lease date reports access', () => {
  it('are read-only and the same for every member role of the company', async () => {
    const [expiry, renewals] = await Promise.all([expiryOf('a'), renewalsOf('a')])
    for (const user of ['admin', 'readOnly', 'owner'] as const) {
      expect((await expiryOf('a', user)).data, user).toEqual(expiry.data)
      expect((await renewalsOf('a', user)).data, user).toEqual(renewals.data)
    }
  })

  it('never answer for another company', async () => {
    expect((await apiErrorOf(expiryOf('b', 'admin'))).status).toBe(403)
    expect((await apiErrorOf(renewalsOf('b', 'readOnly'))).status).toBe(403)
    const b = await expiryOf('b')
    const aIds = new Set(world().companies.a.leases.map((lease) => lease.id))
    expect(b.data.rows.some((row) => aIds.has(row.leaseId))).toBe(false)
  })
})
