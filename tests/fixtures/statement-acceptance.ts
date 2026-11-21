import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * The portfolio the statements acceptance tests (tests/integration/statement-acceptance.test.ts and
 * tests/e2e/statements-acceptance.spec.ts) add to one property of the world's company A, with the service role: two
 * units, two tenants and a verified, active lease for each. Lease 1 is the PRD's escalation example: R35 000.00 a
 * month at 8% a year from 1 March 2026, so a statement for October 2026 that bills R35 000.00 is R2 800.00 short of the
 * expected R37 800.00. Neither lease ends, renews or needs a guarantee soon, so the lease scan raises nothing else that
 * a statement would not explain.
 *
 * `removeAcceptancePortfolio` deletes the portfolio and everything raised from it (monitoring events, statements and
 * their files, communications) in foreign-key order, and checks nothing is left. Audit entries stay (append-only).
 */

export interface AcceptanceParty {
  unitId: string
  unitNumber: string
  tenantId: string
  tradingName: string
  leaseId: string
  leaseReference: string
}

export interface AcceptancePortfolio {
  companyId: string
  propertyId: string
  /** Unique per run: in unit numbers, tenant names, lease references and the statement numbers the tests print. */
  marker: string
  /** Lease 1: R35 000.00 at 8% a year from 01 Mar 2026 (expected R37 800.00 for October 2026). */
  escalating: AcceptanceParty
  /** Lease 2: the tenant whose statements stay unverified. */
  other: AcceptanceParty
}

/** The PRD's escalation example on lease 1. */
export const ESCALATION_EXAMPLE = { initialMonthlyRental: 35_000, percentage: 8, expectedRental: 37_800, difference: 2_800 } as const

function check<T>(what: string, result: { data: T | null; error: { message: string } | null }): T {
  if (result.error || result.data === null) throw new Error(`${what} failed: ${result.error?.message ?? 'no data returned'}`)
  return result.data
}

function expectOk(what: string, result: { error: { message: string } | null }): void {
  if (result.error) throw new Error(`${what} failed: ${result.error.message}`)
}

export async function createAcceptancePortfolio(
  db: SupabaseClient,
  options: { companyId: string; propertyId: string; verifierUserId: string; runId: string },
): Promise<AcceptancePortfolio> {
  const { companyId, propertyId } = options
  // Letters and digits only: unit numbers and statement numbers are single tokens on the statements.
  const marker = options.runId.replace(/[^a-z0-9]/gi, '').slice(-8).toUpperCase()
  const specs = [
    { unit: `S${marker}-12`, tradingName: `Protea Fasteners ${marker}`, rental: ESCALATION_EXAMPLE.initialMonthlyRental, firstEscalation: '2026-03-01' },
    { unit: `S${marker}-14`, tradingName: `Karoo Coffee Roasters ${marker}`, rental: 18_000, firstEscalation: '2027-03-01' },
  ] as const

  const units = check(
    'Insert acceptance units',
    await db
      .from('units')
      .insert(specs.map((spec) => ({ company_id: companyId, property_id: propertyId, unit_number: spec.unit, type: 'line_shop', floor_area_sqm: 240, occupancy_status: 'occupied' })))
      .select('id, unit_number'),
  ) as { id: string; unit_number: string }[]
  const tenants = check(
    'Insert acceptance tenants',
    await db
      .from('tenants')
      .insert(
        specs.map((spec, index) => ({
          company_id: companyId,
          legal_name: `${spec.tradingName} (Pty) Ltd`,
          trading_name: spec.tradingName,
          business_type: 'pty_ltd',
          contact_full_name: `${spec.tradingName} Contact`,
          contact_role: 'Director',
          contact_phone: '+27 11 555 0290',
          whatsapp_number: `+2784900${String(Date.now() % 1000).padStart(3, '0')}${index}`,
          whatsapp_verified: true,
          whatsapp_opted_out: false,
          status: 'active',
          industry: 'Retail',
        })),
      )
      .select('id, trading_name'),
  ) as { id: string; trading_name: string }[]
  const unitOf = (index: number) => units.find((unit) => unit.unit_number === specs[index]!.unit)!
  const tenantOf = (index: number) => tenants.find((tenant) => tenant.trading_name === specs[index]!.tradingName)!

  const verifiedAt = new Date().toISOString()
  const leases = check(
    'Insert acceptance leases',
    await db
      .from('leases')
      .insert(
        specs.map((spec, index) => ({
          company_id: companyId,
          reference: `ACC-${marker}-${index + 1}`,
          property_id: propertyId,
          unit_id: unitOf(index).id,
          tenant_id: tenantOf(index).id,
          commencement_date: '2025-03-01',
          expiry_date: '2029-02-28',
          initial_monthly_rental: spec.rental,
          current_monthly_rental: spec.rental,
          payment_due_day: 1,
          escalation_type: 'percentage',
          escalation_percentage: ESCALATION_EXAMPLE.percentage,
          escalation_frequency: 'annual',
          first_escalation_date: spec.firstEscalation,
          status: 'active',
          verified: true,
          verified_by_user_id: options.verifierUserId,
          verified_at: verifiedAt,
        })),
      )
      .select('id, reference'),
  ) as { id: string; reference: string }[]
  const party = (index: number): AcceptanceParty => {
    const lease = leases.find((candidate) => candidate.reference === `ACC-${marker}-${index + 1}`)!
    return {
      unitId: unitOf(index).id,
      unitNumber: specs[index]!.unit,
      tenantId: tenantOf(index).id,
      tradingName: specs[index]!.tradingName,
      leaseId: lease.id,
      leaseReference: lease.reference,
    }
  }
  return { companyId, propertyId, marker, escalating: party(0), other: party(1) }
}

/** Removes the portfolio and everything raised from it; `statementIds` adds statements without a tenant (copies). */
export async function removeAcceptancePortfolio(db: SupabaseClient, portfolio: AcceptancePortfolio, statementIds: readonly string[] = []): Promise<void> {
  const { companyId } = portfolio
  const tenantIds = [portfolio.escalating.tenantId, portfolio.other.tenantId]
  const leaseIds = [portfolio.escalating.leaseId, portfolio.other.leaseId]
  const unitIds = [portfolio.escalating.unitId, portfolio.other.unitId]

  const statements = check(
    'Find acceptance statements',
    await db
      .from('statements')
      .select('id, storage_path')
      .eq('company_id', companyId)
      .or(`tenant_id.in.(${tenantIds.join(',')}),file_name.ilike.*${portfolio.marker}*${statementIds.length > 0 ? `,id.in.(${statementIds.join(',')})` : ''}`),
  ) as { id: string; storage_path: string }[]
  const ids = statements.map((statement) => statement.id)

  const events = `tenant_id.in.(${tenantIds.join(',')}),lease_id.in.(${leaseIds.join(',')})${ids.length > 0 ? `,statement_id.in.(${ids.join(',')})` : ''}`
  expectOk('Delete acceptance monitoring events', await db.from('monitoring_events').delete().eq('company_id', companyId).or(events))
  expectOk('Delete acceptance communications', await db.from('communications').delete().eq('company_id', companyId).in('tenant_id', tenantIds))
  if (ids.length > 0) {
    // Duplicates point at the statement they repeat: those go first.
    expectOk('Delete acceptance duplicates', await db.from('statements').delete().eq('company_id', companyId).in('id', ids).not('duplicate_of_statement_id', 'is', null))
    expectOk('Delete acceptance statements', await db.from('statements').delete().eq('company_id', companyId).in('id', ids))
    const paths = statements.map((statement) => statement.storage_path)
    expectOk('Remove acceptance statement files', await db.storage.from('statements').remove(paths))
  }
  expectOk('Detach acceptance units', await db.from('units').update({ current_lease_id: null, current_tenant_id: null }).eq('company_id', companyId).in('id', unitIds))
  expectOk('Delete acceptance leases', await db.from('leases').delete().eq('company_id', companyId).in('id', leaseIds))
  expectOk('Delete acceptance tenants', await db.from('tenants').delete().eq('company_id', companyId).in('id', tenantIds))
  expectOk('Delete acceptance units', await db.from('units').delete().eq('company_id', companyId).in('id', unitIds))

  const left = await Promise.all([
    db.from('statements').select('id', { count: 'exact', head: true }).eq('company_id', companyId).in('id', ids.length > 0 ? ids : ['00000000-0000-0000-0000-000000000000']),
    db.from('leases').select('id', { count: 'exact', head: true }).in('id', leaseIds),
    db.from('tenants').select('id', { count: 'exact', head: true }).in('id', tenantIds),
    db.from('units').select('id', { count: 'exact', head: true }).in('id', unitIds),
  ])
  const remaining = left.reduce((sum, result) => sum + (result.count ?? 0), 0)
  if (remaining > 0) throw new Error(`The statements acceptance portfolio was not removed completely (${remaining} rows left)`)
}
