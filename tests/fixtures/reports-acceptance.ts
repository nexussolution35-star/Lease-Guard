import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto'

import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * The known dataset of the reports acceptance tests (ticket R-08: tests/integration/reports-acceptance.test.ts and
 * tests/e2e/reports-acceptance.spec.ts), added with the service role to one company of the world on a property of its
 * own, so every report filtered to that property has exact, known figures. Dates are relative to the South African
 * date the reports are as at (today), so the figures hold whenever the suite runs.
 *
 * On the property (manager: the given manager; owner: the given owner, if any):
 * - three units: U1 (line shop, 200 m²) and U2 (line shop, 150 m²) occupied, U3 (office suite, 100 m²) vacant;
 * - two tenants, T1 and T2;
 * - L1 (T1, U1), verified and active: R35 000 a month at 8% a year, escalated 30 days ago, so R37 800 is expected now
 *   (PRD §5.7 A). Expires in 60 days, with a renewal option and a one-month notice period. Deposit R70 000 sized as two
 *   months (R75 600 required, R5 600 short) and a R105 000 bank guarantee sized as three months (R113 400 required,
 *   R8 400 short), expiring in 900 days;
 * - L2 (T2, U2), verified and active: a flat R20 000 a month, expiring in 500 days, no renewal option, no deposit;
 * - L3 (T2, U3), pending verification, with a R40 000 deposit: it drives no financial monitoring and is listed nowhere;
 * - S1, L1's verified statement dated 10 days ago, billing R35 000 rental for the period starting 20 days ago (R2 800
 *   short of the escalated R37 800), closing balance R12 000;
 * - S2, L2's verified statement dated 45 days ago, billing the R20 000 it should, closing balance R8 000;
 * - S3 waiting for review and S4 rejected (no figures);
 * - an active payment arrangement for T2 on L2 agreed 20 days ago: R8 000 in four monthly instalments of R2 000, the
 *   first (due 10 days ago) recorded as paid; it pauses T2's arrears reminders;
 * - E1, an open rental escalation discrepancy on L1 and S1 (high, identified 5 days ago); E2, an open lease expiry
 *   event on L1 (medium, identified 40 days ago); E3, a resolved lease expiry event on L2;
 * - C1, T1's monthly statement waiting for approval; C2, a payment reminder to T2 still a draft.
 *
 * `removeReportsDataset` deletes all of it, and anything raised from it, in foreign-key order and checks nothing is
 * left. Audit entries stay (append-only).
 */

export interface ReportsDatasetOptions {
  companyId: string
  /** Company admin or property manager of the company: the property's manager, verifier and requester. */
  managerUserId: string
  /** Property owner of the company, or null for a property without an owner. */
  ownerUserId: string | null
  /** Unique per run; letters and digits only are kept. */
  runId: string
  /** The South African date the reports are as at. */
  today: string
}

export interface ReportsDataset {
  companyId: string
  today: string
  marker: string
  property: { id: string; code: string; name: string }
  units: { u1: string; u2: string; u3: string }
  unitNumbers: { u1: string; u2: string; u3: string }
  tenants: { t1: string; t2: string }
  tenantNames: { t1: string; t2: string }
  leases: { l1: string; l2: string; l3: string }
  leaseReferences: { l1: string; l2: string; l3: string }
  statements: { s1: string; s2: string; s3: string; s4: string }
  arrangementId: string
  events: { e1: string; e2: string; e3: string }
  communications: { c1: string; c2: string }
  /** Every id the dataset created. */
  ids: string[]
}

/** The figures the dataset's property must show in every report (as at `today`). */
export const REPORTS_EXPECTED = {
  units: 3,
  occupied: 2,
  vacant: 1,
  floorAreaSqm: 450,
  occupiedAreaSqm: 350,
  activeLeases: 2,
  monthlyRentalRoll: 57_800,
  outstanding: 20_000,
  tenantsInArrears: 2,
  openEvents: 2,
  l1: { expected: 37_800, billed: 35_000, difference: 2_800, expiryDays: 60, depositRequired: 75_600, depositShortfall: 5_600, guaranteeRequired: 113_400, guaranteeShortfall: 8_400 },
  l2: { expected: 20_000, expiryDays: 500 },
  s1: { outstanding: 12_000, ageDays: 10 },
  s2: { outstanding: 8_000, ageDays: 45 },
  arrangement: { outstanding: 8_000, installment: 2_000, paid: 2_000, remaining: 6_000, paidCount: 1, totalCount: 4 },
} as const

/** `iso` plus `days` calendar days (ISO dates, no time zone involved). */
export function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/** `iso` plus `months`, the day clamped to the target month's last day (as the domain's addMonthsISO). */
export function addMonths(iso: string, months: number): string {
  const [year, month, day] = iso.split('-').map(Number) as [number, number, number]
  const target = new Date(Date.UTC(year, month - 1 + months, 1))
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(day, last))
  return target.toISOString().slice(0, 10)
}

const SA_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit' })

/** Today's South African date, the date every report is as at. */
export function saToday(): string {
  return SA_DATE.format(new Date())
}

function check<T>(what: string, result: { data: T | null; error: { message: string } | null }): T {
  if (result.error || result.data === null) throw new Error(`${what} failed: ${result.error?.message ?? 'no data returned'}`)
  return result.data
}

function expectOk(what: string, result: { error: { message: string } | null }): void {
  if (result.error) throw new Error(`${what} failed: ${result.error.message}`)
}

async function insertOne(db: SupabaseClient, table: string, row: Record<string, unknown>, what: string): Promise<string> {
  return (check(what, await db.from(table).insert(row).select('id').single()) as { id: string }).id
}

export async function createReportsDataset(db: SupabaseClient, options: ReportsDatasetOptions): Promise<ReportsDataset> {
  const { companyId, managerUserId, ownerUserId, today } = options
  // Unique per dataset (a run may create one after removing another): unit numbers, names, codes and references.
  const marker = `${options.runId.replace(/[^a-z0-9]/gi, '').slice(-4)}${randomBytes(1).toString('hex')}`.toUpperCase()
  const code = `R${marker}`.slice(0, 8)
  const name = `Reports Acceptance Plaza ${marker}`
  const created: Partial<ReportsDataset> & { ids: string[] } = { ids: [] }
  const keep = (id: string) => {
    created.ids.push(id)
    return id
  }

  try {
    const propertyId = keep(
      await insertOne(
        db,
        'properties',
        {
          company_id: companyId,
          name,
          code,
          type: 'retail',
          address_line1: '8 Acceptance Road',
          suburb: 'Sandton',
          city: 'Johannesburg',
          province: 'Gauteng',
          postal_code: '2196',
          gross_lettable_area_sqm: 450,
          manager_user_id: managerUserId,
          owner_user_id: ownerUserId,
          accounting_system: 'MRI',
        },
        'Insert the acceptance property',
      ),
    )
    created.property = { id: propertyId, code, name }

    const unitNumbers = { u1: `${code}-U1`, u2: `${code}-U2`, u3: `${code}-U3` }
    const unitSpecs = [
      { key: 'u1', type: 'line_shop', floor_area_sqm: 200, occupancy_status: 'occupied' },
      { key: 'u2', type: 'line_shop', floor_area_sqm: 150, occupancy_status: 'occupied' },
      { key: 'u3', type: 'office_suite', floor_area_sqm: 100, occupancy_status: 'vacant' },
    ] as const
    const units = check(
      'Insert the acceptance units',
      await db
        .from('units')
        .insert(unitSpecs.map((spec) => ({ company_id: companyId, property_id: propertyId, unit_number: unitNumbers[spec.key], type: spec.type, floor_area_sqm: spec.floor_area_sqm, occupancy_status: spec.occupancy_status })))
        .select('id, unit_number'),
    ) as { id: string; unit_number: string }[]
    const unitId = (key: keyof typeof unitNumbers) => keep(units.find((unit) => unit.unit_number === unitNumbers[key])!.id)
    created.units = { u1: unitId('u1'), u2: unitId('u2'), u3: unitId('u3') }
    created.unitNumbers = unitNumbers

    const tenantNames = { t1: `Marula Bakery ${marker}`, t2: `Ubuntu Outfitters ${marker}` }
    const numberBase = randomInt(1_000_000, 9_000_000)
    const tenants = check(
      'Insert the acceptance tenants',
      await db
        .from('tenants')
        .insert(
          (['t1', 't2'] as const).map((key, index) => ({
            company_id: companyId,
            legal_name: `${tenantNames[key]} (Pty) Ltd`,
            trading_name: tenantNames[key],
            business_type: 'pty_ltd',
            contact_full_name: `${tenantNames[key]} Contact`,
            contact_role: 'Director',
            contact_phone: '+27 11 555 0280',
            whatsapp_number: `+2783${numberBase + index}`,
            whatsapp_verified: true,
            whatsapp_opted_out: false,
            status: 'active',
            industry: 'Retail',
          })),
        )
        .select('id, trading_name'),
    ) as { id: string; trading_name: string }[]
    const tenantId = (key: keyof typeof tenantNames) => keep(tenants.find((tenant) => tenant.trading_name === tenantNames[key])!.id)
    created.tenants = { t1: tenantId('t1'), t2: tenantId('t2') }
    created.tenantNames = tenantNames

    const leaseReferences = { l1: `${code}-L1`, l2: `${code}-L2`, l3: `${code}-L3` }
    const verifiedAt = new Date().toISOString()
    const verified = { status: 'active', verified: true, verified_by_user_id: managerUserId, verified_at: verifiedAt }
    const common = { company_id: companyId, property_id: propertyId, commencement_date: addDays(today, -400), payment_due_day: 1, escalation_frequency: 'annual' }
    const leases = check(
      'Insert the acceptance leases',
      await db
        .from('leases')
        .insert([
          {
            ...common,
            ...verified,
            reference: leaseReferences.l1,
            unit_id: created.units.u1,
            tenant_id: created.tenants.t1,
            expiry_date: addDays(today, 60),
            initial_monthly_rental: 35_000,
            current_monthly_rental: 37_800,
            escalation_type: 'percentage',
            escalation_percentage: 8,
            first_escalation_date: addDays(today, -30),
            renewal_option_exists: true,
            renewal_notice_period_months: 1,
            renewal_term_months: 36,
            deposit_amount: 70_000,
            deposit_basis_months: 2,
            deposit_held_by: 'landlord',
            deposit_interest_bearing: true,
          },
          {
            ...common,
            ...verified,
            reference: leaseReferences.l2,
            unit_id: created.units.u2,
            tenant_id: created.tenants.t2,
            expiry_date: addDays(today, 500),
            initial_monthly_rental: 20_000,
            current_monthly_rental: 20_000,
            escalation_type: 'none',
            escalation_percentage: null,
            first_escalation_date: addDays(today, 30),
            renewal_option_exists: false,
          },
          {
            ...common,
            reference: leaseReferences.l3,
            unit_id: created.units.u3,
            tenant_id: created.tenants.t2,
            expiry_date: addDays(today, 700),
            initial_monthly_rental: 15_000,
            current_monthly_rental: 15_000,
            escalation_type: 'none',
            escalation_percentage: null,
            first_escalation_date: addDays(today, 30),
            renewal_option_exists: false,
            deposit_amount: 40_000,
            deposit_basis_months: 2,
            deposit_held_by: 'managing_agent',
            deposit_interest_bearing: false,
            status: 'pending_verification',
            verified: false,
          },
        ])
        .select('id, reference'),
    ) as { id: string; reference: string }[]
    const leaseId = (key: keyof typeof leaseReferences) => keep(leases.find((lease) => lease.reference === leaseReferences[key])!.id)
    created.leases = { l1: leaseId('l1'), l2: leaseId('l2'), l3: leaseId('l3') }
    created.leaseReferences = leaseReferences

    // The occupied units' current tenant comes from their lease (the vacant unit has none).
    for (const [unit, lease, tenant] of [
      [created.units.u1, created.leases.l1, created.tenants.t1],
      [created.units.u2, created.leases.l2, created.tenants.t2],
    ] as const) {
      expectOk('Set the unit\'s current lease', await db.from('units').update({ current_lease_id: lease, current_tenant_id: tenant }).eq('company_id', companyId).eq('id', unit))
    }

    keep(
      await insertOne(
        db,
        'lease_bank_guarantees',
        {
          company_id: companyId,
          lease_id: created.leases.l1,
          bank: 'Standard Bank',
          reference_number: `BG-${code}-1`,
          amount: 105_000,
          basis_months: 3,
          issued_on: addDays(today, -400),
          expires_on: addDays(today, 900),
          status: 'active',
        },
        'Insert the acceptance guarantee',
      ),
    )

    const statement = async (seed: string, fields: Record<string, unknown>) => {
      const file = randomUUID()
      return keep(
        await insertOne(
          db,
          'statements',
          {
            company_id: companyId,
            property_id: propertyId,
            file_name: `it-r08-${code}-${seed}.pdf`,
            storage_path: `${companyId}/${file}/it-r08-${seed}.pdf`,
            mime_type: 'application/pdf',
            size_bytes: 2048,
            file_sha256: createHash('sha256').update(`${options.runId}:r08:${companyId}:${marker}:${seed}`).digest('hex'),
            source_system: 'MRI',
            uploaded_by_user_id: managerUserId,
            ...fields,
          },
          `Insert statement ${seed}`,
        ),
      )
    }
    const verifiedStatement = (lease: string, unit: string, tenant: string, statementDate: string, periodStart: string, rental: number, closing: number) => ({
      tenant_id: tenant,
      unit_id: unit,
      lease_id: lease,
      status: 'verified',
      statement_date: statementDate,
      period_start: periodStart,
      period_end: addDays(periodStart, 29),
      opening_balance: closing - rental,
      rental_charged: rental,
      additional_charges: 0,
      payments_received: 0,
      closing_balance: closing,
      total_due: closing,
      verified_by_user_id: managerUserId,
      verified_at: verifiedAt,
    })
    created.statements = {
      s1: await statement('s1', verifiedStatement(created.leases.l1, created.units.u1, created.tenants.t1, addDays(today, -10), addDays(today, -20), 35_000, 12_000)),
      s2: await statement('s2', verifiedStatement(created.leases.l2, created.units.u2, created.tenants.t2, addDays(today, -45), addDays(today, -60), 20_000, 8_000)),
      s3: await statement('s3', { tenant_id: created.tenants.t1, status: 'review_required' }),
      s4: await statement('s4', { status: 'rejected', rejection_reason: 'Not a statement of this property' }),
    }

    const arrangementId = keep(
      await insertOne(
        db,
        'payment_arrangements',
        {
          company_id: companyId,
          tenant_id: created.tenants.t2,
          property_id: propertyId,
          unit_id: created.units.u2,
          lease_id: created.leases.l2,
          outstanding_balance: 8_000,
          installment_amount: 2_000,
          frequency: 'monthly',
          first_installment_date: addDays(today, -10),
          final_installment_date: addMonths(addDays(today, -10), 3),
          agreed_by_user_id: managerUserId,
          agreed_on: addDays(today, -20),
          status: 'active',
        },
        'Insert the acceptance arrangement',
      ),
    )
    created.arrangementId = arrangementId
    expectOk(
      'Insert the acceptance instalments',
      await db.from('arrangement_installments').insert(
        [0, 1, 2, 3].map((index) => ({
          company_id: companyId,
          arrangement_id: arrangementId,
          sequence: index + 1,
          due_date: addMonths(addDays(today, -10), index),
          amount: 2_000,
          status: index === 0 ? 'confirmed_paid' : 'scheduled',
          confirmed_by_user_id: index === 0 ? managerUserId : null,
          confirmed_on: index === 0 ? addDays(today, -10) : null,
        })),
      ),
    )

    const event = (fields: Record<string, unknown>, what: string) =>
      insertOne(
        db,
        'monitoring_events',
        {
          company_id: companyId,
          property_id: propertyId,
          recommended_action: 'Review the lease terms and the statement.',
          description: `${String(fields.title)} (reports acceptance ${options.runId}).`,
          ...fields,
        },
        what,
      ).then(keep)
    created.events = {
      e1: await event(
        {
          type: 'rental_escalation_discrepancy',
          title: `Rental billed short on ${leaseReferences.l1}`,
          unit_id: created.units.u1,
          tenant_id: created.tenants.t1,
          lease_id: created.leases.l1,
          lease_reference: leaseReferences.l1,
          statement_id: created.statements.s1,
          identified_on: addDays(today, -5),
          priority: 'high',
          calculation: { expectedAmount: 37_800, actualAmount: 35_000, difference: 2_800, steps: ['R35 000.00 escalated by 8% = R37 800.00', 'Billed R35 000.00: R2 800.00 short'] },
          status: 'new',
        },
        'Insert the discrepancy event',
      ),
      e2: await event(
        {
          type: 'lease_expiry',
          title: `Lease ${leaseReferences.l1} expires within 90 days`,
          unit_id: created.units.u1,
          tenant_id: created.tenants.t1,
          lease_id: created.leases.l1,
          lease_reference: leaseReferences.l1,
          identified_on: addDays(today, -40),
          due_date: addDays(today, 60),
          priority: 'medium',
          status: 'under_review',
        },
        'Insert the expiry event',
      ),
      e3: await event(
        {
          type: 'lease_expiry',
          title: `Lease ${leaseReferences.l2} expiry reviewed`,
          unit_id: created.units.u2,
          tenant_id: created.tenants.t2,
          lease_id: created.leases.l2,
          lease_reference: leaseReferences.l2,
          identified_on: addDays(today, -100),
          priority: 'low',
          status: 'resolved',
          resolved_at: new Date().toISOString(),
          resolved_by_user_id: managerUserId,
          resolution_notes: 'Reviewed with the tenant.',
        },
        'Insert the resolved event',
      ),
    }

    const numberOf = (tenant: string) => `+2783${numberBase + (tenant === created.tenants?.t1 ? 0 : 1)}`
    const message = (tenant: string, lease: string, fields: Record<string, unknown>, what: string) =>
      insertOne(
        db,
        'communications',
        {
          company_id: companyId,
          channel: 'whatsapp',
          direction: 'outbound',
          recipient_type: 'tenant',
          tenant_id: tenant,
          property_id: propertyId,
          lease_id: lease,
          counterparty_number: numberOf(tenant),
          company_number: '+27115550100',
          body: `Good day. Your statement is attached. (reports acceptance ${options.runId})`,
          created_by_user_id: managerUserId,
          ...fields,
        },
        what,
      ).then(keep)
    const c1 = await message(created.tenants.t1, created.leases.l1, { message_type: 'monthly_statement', statement_id: created.statements.s1, status: 'pending_approval' }, 'Insert the pending message')
    keep(await insertOne(db, 'message_approvals', { company_id: companyId, communication_id: c1, requested_by_user_id: managerUserId }, 'Request approval'))
    const c2 = await message(created.tenants.t2, created.leases.l2, { message_type: 'overdue_payment_reminder', status: 'draft' }, 'Insert the draft message')
    created.communications = { c1, c2 }

    return { ...(created as ReportsDataset), companyId, today, marker }
  } catch (error) {
    await removeReportsDataset(db, { ...(created as ReportsDataset), companyId, today, marker }).catch((cleanupError: unknown) =>
      console.error('[reports acceptance] cleanup after a failed setup failed:', cleanupError),
    )
    throw error
  }
}

/** Removes the dataset and everything raised from it (it may be partly created); checks nothing is left. */
export async function removeReportsDataset(db: SupabaseClient, dataset: Partial<ReportsDataset> & { companyId: string }): Promise<void> {
  const { companyId } = dataset
  const propertyId = dataset.property?.id
  if (!propertyId) return
  const tenantIds = Object.values(dataset.tenants ?? {})
  const unitIds = Object.values(dataset.units ?? {})
  const leaseIds = Object.values(dataset.leases ?? {})

  const events = check('Find the dataset\'s events', await db.from('monitoring_events').select('id').eq('company_id', companyId).eq('property_id', propertyId)) as { id: string }[]
  if (events.length > 0) {
    const ids = events.map((row) => row.id)
    expectOk('Delete the event notifications', await db.from('notifications').delete().eq('company_id', companyId).eq('link_entity_type', 'monitoring_event').in('link_entity_id', ids))
    expectOk('Delete the events', await db.from('monitoring_events').delete().eq('company_id', companyId).in('id', ids))
  }
  // Approval requests cascade with their communication.
  expectOk('Delete the messages', await db.from('communications').delete().eq('company_id', companyId).eq('property_id', propertyId))
  if (tenantIds.length > 0) expectOk('Delete the tenants\' messages', await db.from('communications').delete().eq('company_id', companyId).in('tenant_id', tenantIds))
  const arrangements = check('Find the arrangements', await db.from('payment_arrangements').select('id').eq('company_id', companyId).eq('property_id', propertyId)) as { id: string }[]
  if (arrangements.length > 0) {
    const ids = arrangements.map((row) => row.id)
    expectOk('Delete the instalments', await db.from('arrangement_installments').delete().eq('company_id', companyId).in('arrangement_id', ids))
    expectOk('Delete the arrangements', await db.from('payment_arrangements').delete().eq('company_id', companyId).in('id', ids))
  }
  expectOk('Delete the statements', await db.from('statements').delete().eq('company_id', companyId).eq('property_id', propertyId))
  if (leaseIds.length > 0) expectOk('Delete the guarantees', await db.from('lease_bank_guarantees').delete().eq('company_id', companyId).in('lease_id', leaseIds))
  if (unitIds.length > 0) expectOk('Detach the units', await db.from('units').update({ current_lease_id: null, current_tenant_id: null }).eq('company_id', companyId).in('id', unitIds))
  if (leaseIds.length > 0) expectOk('Delete the leases', await db.from('leases').delete().eq('company_id', companyId).in('id', leaseIds))
  if (tenantIds.length > 0) expectOk('Delete the tenants', await db.from('tenants').delete().eq('company_id', companyId).in('id', tenantIds))
  expectOk('Delete the units', await db.from('units').delete().eq('company_id', companyId).eq('property_id', propertyId))
  expectOk('Delete the property', await db.from('properties').delete().eq('company_id', companyId).eq('id', propertyId))

  const left = await Promise.all([
    db.from('properties').select('id', { count: 'exact', head: true }).eq('id', propertyId),
    db.from('units').select('id', { count: 'exact', head: true }).eq('property_id', propertyId),
    db.from('statements').select('id', { count: 'exact', head: true }).eq('property_id', propertyId),
    db.from('monitoring_events').select('id', { count: 'exact', head: true }).eq('property_id', propertyId),
  ])
  const remaining = left.reduce((sum, result) => sum + (result.count ?? 0), 0)
  if (remaining > 0) throw new Error(`The reports acceptance dataset was not removed completely (${remaining} rows left)`)
}
