import { createHash, randomInt } from 'node:crypto'

import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * The portfolio of the monitoring accuracy acceptance (ticket M7-06, PRD §13.4 and §5.7 A-E), added to one property of
 * the world's company A with the service role: one unit, tenant and lease per rule, each built so that its rule, and
 * only its rule, fires on the scenario's date. Every figure is the PRD's example or follows from it:
 *
 * - `escalation`: R35 000.00 a month at 8% a year from 01 Mar 2026; its verified October 2026 statement bills
 *   R35 000.00, so the expected rental is R37 800.00 and the discrepancy R2 800.00 (§5.7 A).
 * - `expiry`: expires 15 Jan 2027, 74 days after 02 Nov 2026, inside the company's 90-day notice threshold (§5.7 B).
 * - `renewal`: expires 31 Dec 2027 with a renewal option exercised by notice three months before expiry, so the
 *   deadline is 30 Sep 2027; on 01 Aug 2027 it is 60 days away (§5.7 C, the PRD's own example).
 * - `shortfall`: a bank guarantee of R105 000.00 sized as three months of the original R35 000.00; after the 8%
 *   escalation three months are R113 400.00, so it is R8 400.00 short (§5.7 D, the PRD's own example).
 * - `guaranteeExpiry`: a fully covering guarantee that expires 30 Nov 2026, 28 days after 02 Nov 2026 (§5.7 D).
 * - `arrears`: a verified statement of 30 Sep 2026 with R46 000.00 outstanding, 33 days old on 02 Nov 2026: ageing
 *   bucket 30 (§5.7 E).
 * - `unverified`: a lease pending verification that would trip expiry, renewal, guarantee expiry and guarantee
 *   shortfall at once, with a statement still under review (no figures): nothing may come of either.
 *
 * Statements are inserted as verification leaves them (figures, verifier and time), the way
 * tests/integration/statement-arrears.test.ts does; verifying one through the API is proved by
 * tests/integration/statement-acceptance.test.ts. `removeMonitoringPortfolio` deletes everything, and everything raised
 * from it, in foreign-key order and checks nothing is left. Audit entries stay (append-only).
 */

/** The date every scenario but the renewal one is scanned on. */
export const AS_OF = '2026-11-02'

export const EXAMPLES = {
  escalation: { initialMonthlyRental: 35_000, percentage: 8, firstEscalationDate: '2026-03-01', billedRental: 35_000, expectedRental: 37_800, difference: 2_800 },
  expiry: { expiryDate: '2027-01-15', daysUntilExpiry: 74, threshold: 90 },
  renewal: { asOf: '2027-08-01', expiryDate: '2027-12-31', noticePeriodMonths: 3, deadline: '2027-09-30', daysUntilDeadline: 60, threshold: 60 },
  shortfall: { guaranteeAmount: 105_000, basisMonths: 3, required: 113_400, shortfall: 8_400 },
  guaranteeExpiry: { amount: 60_000, expiresOn: '2026-11-30', threshold: 30 },
  arrears: { statementDate: '2026-09-30', outstanding: 46_000, bucket: '30' },
} as const

export const SCENARIOS = ['escalation', 'expiry', 'renewal', 'shortfall', 'guaranteeExpiry', 'arrears', 'unverified'] as const
export type Scenario = (typeof SCENARIOS)[number]

export interface MonitoringParty {
  unitId: string
  unitNumber: string
  tenantId: string
  tradingName: string
  leaseId: string
  leaseReference: string
  /** The scenario's statement, when it has one. */
  statementId?: string
}

export interface MonitoringPortfolio {
  companyId: string
  propertyId: string
  /** Unique per run: in unit numbers, tenant names, lease references and file names. */
  marker: string
  parties: Record<Scenario, MonitoringParty>
}

function check<T>(what: string, result: { data: T | null; error: { message: string } | null }): T {
  if (result.error || result.data === null) throw new Error(`${what} failed: ${result.error?.message ?? 'no data returned'}`)
  return result.data
}

function expectOk(what: string, result: { error: { message: string } | null }): void {
  if (result.error) throw new Error(`${what} failed: ${result.error.message}`)
}

type LeaseTerms = Record<string, string | number | boolean | null>

const flat = (rental: number): LeaseTerms => ({
  initial_monthly_rental: rental,
  current_monthly_rental: rental,
  escalation_type: 'none',
  escalation_percentage: null,
  first_escalation_date: '2026-03-01',
})
const escalating: LeaseTerms = {
  initial_monthly_rental: EXAMPLES.escalation.initialMonthlyRental,
  current_monthly_rental: EXAMPLES.escalation.initialMonthlyRental,
  escalation_type: 'percentage',
  escalation_percentage: EXAMPLES.escalation.percentage,
  first_escalation_date: EXAMPLES.escalation.firstEscalationDate,
}

/** Each scenario's lease terms (the rest of a lease is common, see `createMonitoringPortfolio`). */
const LEASES: Record<Scenario, LeaseTerms> = {
  escalation: { ...escalating, commencement_date: '2025-03-01', expiry_date: '2029-02-28' },
  expiry: { ...flat(20_000), commencement_date: '2024-01-16', expiry_date: EXAMPLES.expiry.expiryDate },
  renewal: {
    ...flat(20_000),
    commencement_date: '2025-01-01',
    expiry_date: EXAMPLES.renewal.expiryDate,
    renewal_option_exists: true,
    renewal_term_months: 60,
    renewal_notice_period_months: EXAMPLES.renewal.noticePeriodMonths,
  },
  shortfall: { ...escalating, commencement_date: '2025-03-01', expiry_date: '2029-02-28' },
  guaranteeExpiry: { ...flat(20_000), commencement_date: '2025-03-01', expiry_date: '2029-02-28' },
  arrears: { ...flat(20_000), commencement_date: '2025-03-01', expiry_date: '2029-02-28' },
  unverified: {
    ...escalating,
    commencement_date: '2024-01-16',
    expiry_date: EXAMPLES.expiry.expiryDate,
    renewal_option_exists: true,
    renewal_term_months: 60,
    // Deadline 15 Dec 2026: 43 days after 02 Nov 2026, inside the 60-day warning.
    renewal_notice_period_months: 1,
  },
}

const GUARANTEES: Partial<Record<Scenario, { amount: number; basis_months: number; issued_on: string; expires_on: string }>> = {
  shortfall: { amount: EXAMPLES.shortfall.guaranteeAmount, basis_months: EXAMPLES.shortfall.basisMonths, issued_on: '2025-03-01', expires_on: '2029-05-31' },
  guaranteeExpiry: { amount: EXAMPLES.guaranteeExpiry.amount, basis_months: 3, issued_on: '2025-11-30', expires_on: EXAMPLES.guaranteeExpiry.expiresOn },
  // Expiring (28 days) and short (R105 000 against R113 400): both rules would fire if the lease were verified.
  unverified: { amount: EXAMPLES.shortfall.guaranteeAmount, basis_months: EXAMPLES.shortfall.basisMonths, issued_on: '2025-11-30', expires_on: EXAMPLES.guaranteeExpiry.expiresOn },
}

const NAMES: Record<Scenario, string> = {
  escalation: 'Protea Fasteners',
  expiry: 'Fynbos Florists',
  renewal: 'Kudu Hardware',
  shortfall: 'Marula Optometrists',
  guaranteeExpiry: 'Quagga Cycles',
  arrears: 'Springbok Stationers',
  unverified: 'Yellowwood Books',
}

export async function createMonitoringPortfolio(
  db: SupabaseClient,
  options: { companyId: string; propertyId: string; verifierUserId: string; runId: string },
): Promise<MonitoringPortfolio> {
  const { companyId, propertyId } = options
  const marker = options.runId.replace(/[^a-z0-9]/gi, '').slice(-8).toUpperCase()
  const unitNumber = (index: number) => `M${marker}-${String(index + 1).padStart(2, '0')}`
  const tradingName = (scenario: Scenario) => `${NAMES[scenario]} ${marker}`
  const reference = (index: number) => `MON-${marker}-${index + 1}`

  const units = check(
    'Insert monitoring units',
    await db
      .from('units')
      .insert(SCENARIOS.map((_, index) => ({ company_id: companyId, property_id: propertyId, unit_number: unitNumber(index), type: 'line_shop', floor_area_sqm: 180, occupancy_status: 'occupied' })))
      .select('id, unit_number'),
  ) as { id: string; unit_number: string }[]
  const numberBase = randomInt(1_000_000, 9_000_000)
  const tenants = check(
    'Insert monitoring tenants',
    await db
      .from('tenants')
      .insert(
        SCENARIOS.map((scenario, index) => ({
          company_id: companyId,
          legal_name: `${tradingName(scenario)} (Pty) Ltd`,
          trading_name: tradingName(scenario),
          business_type: 'pty_ltd',
          contact_full_name: `${tradingName(scenario)} Contact`,
          contact_role: 'Director',
          contact_phone: '+27 11 555 0290',
          whatsapp_number: `+2782${numberBase + index}`,
          whatsapp_verified: true,
          whatsapp_opted_out: false,
          status: 'active',
          industry: 'Retail',
        })),
      )
      .select('id, trading_name'),
  ) as { id: string; trading_name: string }[]
  const unitOf = (index: number) => units.find((unit) => unit.unit_number === unitNumber(index))!
  const tenantOf = (scenario: Scenario) => tenants.find((tenant) => tenant.trading_name === tradingName(scenario))!

  const verifiedAt = new Date().toISOString()
  const leases = check(
    'Insert monitoring leases',
    await db
      .from('leases')
      .insert(
        SCENARIOS.map((scenario, index) => {
          const verified = scenario !== 'unverified'
          return {
            company_id: companyId,
            reference: reference(index),
            property_id: propertyId,
            unit_id: unitOf(index).id,
            tenant_id: tenantOf(scenario).id,
            payment_due_day: 1,
            escalation_frequency: 'annual',
            renewal_option_exists: false,
            renewal_term_months: null,
            renewal_notice_period_months: null,
            ...LEASES[scenario],
            status: verified ? 'active' : 'pending_verification',
            verified,
            verified_by_user_id: verified ? options.verifierUserId : null,
            verified_at: verified ? verifiedAt : null,
          }
        }),
      )
      .select('id, reference'),
  ) as { id: string; reference: string }[]
  const leaseOf = (index: number) => leases.find((lease) => lease.reference === reference(index))!

  const guaranteed = SCENARIOS.flatMap((scenario, index) => {
    const terms = GUARANTEES[scenario]
    return terms
      ? [{ company_id: companyId, lease_id: leaseOf(index).id, bank: 'Standard Bank', reference_number: `BG-${marker}-${index + 1}`, status: 'active', ...terms }]
      : []
  })
  expectOk('Insert monitoring bank guarantees', await db.from('lease_bank_guarantees').insert(guaranteed))

  const parties = Object.fromEntries(
    SCENARIOS.map((scenario, index) => [
      scenario,
      {
        unitId: unitOf(index).id,
        unitNumber: unitNumber(index),
        tenantId: tenantOf(scenario).id,
        tradingName: tradingName(scenario),
        leaseId: leaseOf(index).id,
        leaseReference: reference(index),
      } satisfies MonitoringParty,
    ]),
  ) as Record<Scenario, MonitoringParty>
  const portfolio: MonitoringPortfolio = { companyId, propertyId, marker, parties }

  // Verified statements carry the figures verification saved; the one under review carries none.
  const verifiedBy = { verified_by_user_id: options.verifierUserId, verified_at: verifiedAt }
  parties.escalation.statementId = await insertStatement(db, portfolio, 'escalation', options.verifierUserId, {
    status: 'verified',
    statement_date: '2026-10-31',
    period_start: '2026-10-01',
    period_end: '2026-10-31',
    opening_balance: 0,
    rental_charged: EXAMPLES.escalation.billedRental,
    additional_charges: 0,
    payments_received: EXAMPLES.escalation.billedRental,
    closing_balance: 0,
    total_due: 0,
    ...verifiedBy,
  })
  parties.arrears.statementId = await insertStatement(db, portfolio, 'arrears', options.verifierUserId, {
    status: 'verified',
    statement_date: EXAMPLES.arrears.statementDate,
    period_start: '2026-09-01',
    period_end: EXAMPLES.arrears.statementDate,
    opening_balance: EXAMPLES.arrears.outstanding - 20_000,
    rental_charged: 20_000,
    additional_charges: 0,
    payments_received: 0,
    closing_balance: EXAMPLES.arrears.outstanding,
    total_due: EXAMPLES.arrears.outstanding,
    ...verifiedBy,
  })
  parties.unverified.statementId = await insertStatement(db, portfolio, 'unverified', options.verifierUserId, { status: 'review_required' })
  return portfolio
}

async function insertStatement(db: SupabaseClient, portfolio: MonitoringPortfolio, scenario: Scenario, uploadedBy: string, fields: Record<string, unknown>): Promise<string> {
  const party = portfolio.parties[scenario]
  const name = `monitoring-${portfolio.marker}-${scenario}.pdf`
  const row = check(
    `Insert the ${scenario} statement`,
    await db
      .from('statements')
      .insert({
        company_id: portfolio.companyId,
        property_id: portfolio.propertyId,
        tenant_id: party.tenantId,
        unit_id: party.unitId,
        lease_id: party.leaseId,
        file_name: name,
        storage_path: `${portfolio.companyId}/${party.leaseId}/${name}`,
        mime_type: 'application/pdf',
        size_bytes: 2048,
        file_sha256: createHash('sha256').update(name).digest('hex'),
        source_system: 'MRI',
        uploaded_by_user_id: uploadedBy,
        ...fields,
      })
      .select('id')
      .single(),
  ) as { id: string }
  return row.id
}

/** Removes the portfolio and everything raised from it (events, their notifications, communications, statements). */
export async function removeMonitoringPortfolio(db: SupabaseClient, portfolio: MonitoringPortfolio): Promise<void> {
  const { companyId } = portfolio
  const parties = Object.values(portfolio.parties)
  const tenantIds = parties.map((party) => party.tenantId)
  const leaseIds = parties.map((party) => party.leaseId)
  const unitIds = parties.map((party) => party.unitId)

  const events = check(
    'Find monitoring acceptance events',
    await db.from('monitoring_events').select('id').eq('company_id', companyId).or(`tenant_id.in.(${tenantIds.join(',')}),lease_id.in.(${leaseIds.join(',')})`),
  ) as { id: string }[]
  const eventIds = events.map((event) => event.id)
  if (eventIds.length > 0) {
    expectOk('Delete monitoring acceptance notifications', await db.from('notifications').delete().eq('company_id', companyId).eq('link_entity_type', 'monitoring_event').in('link_entity_id', eventIds))
    expectOk('Delete monitoring acceptance events', await db.from('monitoring_events').delete().eq('company_id', companyId).in('id', eventIds))
  }
  expectOk('Delete monitoring acceptance communications', await db.from('communications').delete().eq('company_id', companyId).in('tenant_id', tenantIds))
  expectOk('Delete monitoring acceptance statements', await db.from('statements').delete().eq('company_id', companyId).in('tenant_id', tenantIds))
  expectOk('Detach monitoring acceptance units', await db.from('units').update({ current_lease_id: null, current_tenant_id: null }).eq('company_id', companyId).in('id', unitIds))
  expectOk('Delete monitoring acceptance leases', await db.from('leases').delete().eq('company_id', companyId).in('id', leaseIds))
  expectOk('Delete monitoring acceptance tenants', await db.from('tenants').delete().eq('company_id', companyId).in('id', tenantIds))
  expectOk('Delete monitoring acceptance units', await db.from('units').delete().eq('company_id', companyId).in('id', unitIds))

  const left = await Promise.all([
    db.from('monitoring_events').select('id', { count: 'exact', head: true }).in('tenant_id', tenantIds),
    db.from('statements').select('id', { count: 'exact', head: true }).in('tenant_id', tenantIds),
    db.from('leases').select('id', { count: 'exact', head: true }).in('id', leaseIds),
    db.from('tenants').select('id', { count: 'exact', head: true }).in('id', tenantIds),
    db.from('units').select('id', { count: 'exact', head: true }).in('id', unitIds),
  ])
  const remaining = left.reduce((sum, result) => sum + (result.count ?? 0), 0)
  if (remaining > 0) throw new Error(`The monitoring acceptance portfolio was not removed completely (${remaining} rows left)`)
}
