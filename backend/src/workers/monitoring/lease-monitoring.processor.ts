import { Injectable, Logger, type OnModuleInit } from '@nestjs/common'
import { compareISODate, isValidISODate, MONITORED_LEASE_STATUSES, type EntityId } from '@leaseguard/domain'
import { UnrecoverableError } from 'bullmq'

import { ServiceRoleClientFactory } from '../../infrastructure/database/service-role-client.factory'
import type { JobPayloads } from '../../infrastructure/queues/queue-registry'
import { toLeaseFromQuery } from '../../infrastructure/database/lease-rows'
import { ProcessorRuntime } from '../jobs/processor-runtime'
import { fetchAll } from '../shared/db'
import { MonitoringOutputs } from '../shared/monitoring-outputs'
import { loadMonitoringSettings } from '../shared/monitoring-settings'
import { type BilledRental, leaseFindings } from './lease-monitoring.findings'
import { loadRecordNames, type ScanSummary } from './monitoring-data'

/**
 * Daily lease scan for one company: expiry, renewal notice deadlines, bank guarantee expiry and
 * shortfall, deposit shortfall and rental escalation discrepancies, from VERIFIED leases only.
 */
@Injectable()
export class LeaseMonitoringProcessor implements OnModuleInit {
  private readonly logger = new Logger(LeaseMonitoringProcessor.name)

  constructor(
    private readonly runtime: ProcessorRuntime,
    private readonly clients: ServiceRoleClientFactory,
  ) {}

  onModuleInit(): void {
    this.runtime.start('lease-monitoring', (payload) => this.scan(payload))
  }

  async scan({ companyId, asOf }: JobPayloads['lease-monitoring']): Promise<ScanSummary> {
    if (!isValidISODate(asOf)) throw new UnrecoverableError(`Invalid asOf date "${asOf}"`)
    const db = this.clients.get()
    const settings = await loadMonitoringSettings(db, companyId, (type, reason) =>
      this.logger.warn({ companyId, eventType: type, reason }, 'Ignoring invalid monitoring rule config'),
    )
    if (!settings) return { findings: 0, created: 0, notified: 0, skipped: 'company_inactive' }

    const [leaseRows, statements, names] = await Promise.all([
      fetchAll('Load verified leases', (from, to) =>
        db
          .from('leases')
          .select('*, lease_bank_guarantees(*)')
          .eq('company_id', companyId)
          .eq('verified', true)
          .in('status', [...MONITORED_LEASE_STATUSES])
          .order('id')
          .range(from, to),
      ),
      fetchAll('Load verified statements', (from, to) =>
        db
          .from('statements')
          .select('id, lease_id, statement_date, period_start, rental_charged')
          .eq('company_id', companyId)
          .eq('status', 'verified')
          .not('lease_id', 'is', null)
          .order('id')
          .range(from, to),
      ),
      loadRecordNames(db, companyId),
    ])

    // The latest verified statement of each lease is the authoritative billed rental.
    const latest = new Map<EntityId, { statementDate: string } & BilledRental>()
    for (const row of statements) {
      if (!row.lease_id || row.rental_charged === null) continue
      const previous = latest.get(row.lease_id)
      if (previous && compareISODate(row.statement_date, previous.statementDate) <= 0) continue
      latest.set(row.lease_id, {
        statementId: row.id,
        statementDate: row.statement_date,
        periodStart: row.period_start,
        rentalCharged: row.rental_charged,
      })
    }

    const drafts = leaseFindings({
      leases: leaseRows.map(toLeaseFromQuery),
      billedRentals: latest,
      settings,
      names,
      asOf,
    })
    const result = await new MonitoringOutputs(db, companyId).raise(drafts)
    this.logger.log({ companyId, asOf, leases: leaseRows.length, findings: drafts.length, ...result }, 'Lease monitoring complete')
    return { findings: drafts.length, ...result }
  }
}
