import { Injectable, Logger, type OnModuleInit } from '@nestjs/common'
import { isValidISODate } from '@leaseguard/domain'
import { UnrecoverableError } from 'bullmq'

import { ServiceRoleClientFactory } from '../../infrastructure/database/service-role-client.factory'
import type { JobPayloads } from '../../infrastructure/queues/queue-registry'
import { loadReminderArrangements } from '../../messaging/reminder-arrangements'
import { ProcessorRuntime } from '../jobs/processor-runtime'
import { fetchAll } from '../shared/db'
import { MonitoringOutputs } from '../shared/monitoring-outputs'
import { loadMonitoringSettings } from '../shared/monitoring-settings'
import { arrearsFindings, type ArrearsStatement } from './arrears-monitoring.findings'
import { loadRecordNames, type ScanSummary } from './monitoring-data'

/** Daily arrears ageing for one company from verified statements, honouring active payment arrangements. */
@Injectable()
export class ArrearsMonitoringProcessor implements OnModuleInit {
  private readonly logger = new Logger(ArrearsMonitoringProcessor.name)

  constructor(
    private readonly runtime: ProcessorRuntime,
    private readonly clients: ServiceRoleClientFactory,
  ) {}

  onModuleInit(): void {
    this.runtime.start('arrears-monitoring', (payload) => this.scan(payload))
  }

  async scan({ companyId, asOf }: JobPayloads['arrears-monitoring']): Promise<ScanSummary & { suppressed: number }> {
    if (!isValidISODate(asOf)) throw new UnrecoverableError(`Invalid asOf date "${asOf}"`)
    const db = this.clients.get()
    const settings = await loadMonitoringSettings(db, companyId, (type, reason) =>
      this.logger.warn({ companyId, eventType: type, reason }, 'Ignoring invalid monitoring rule config'),
    )
    if (!settings) return { findings: 0, created: 0, notified: 0, suppressed: 0, skipped: 'company_inactive' }

    const [statementRows, arrangements, names] = await Promise.all([
      fetchAll('Load verified statements', (from, to) =>
        db
          .from('statements')
          .select('id, tenant_id, property_id, unit_id, lease_id, status, statement_date, closing_balance, total_due')
          .eq('company_id', companyId)
          .eq('status', 'verified')
          .not('tenant_id', 'is', null)
          .order('id')
          .range(from, to),
      ),
      // The same arrangement read and mapping the outbound gate uses, so suppression cannot drift.
      loadReminderArrangements(db, companyId, { activeOnly: true }),
      loadRecordNames(db, companyId),
    ])

    const statements: ArrearsStatement[] = statementRows.map((row) => ({
      id: row.id,
      propertyId: row.property_id,
      ...(row.tenant_id ? { tenantId: row.tenant_id } : {}),
      ...(row.unit_id ? { unitId: row.unit_id } : {}),
      ...(row.lease_id ? { leaseId: row.lease_id } : {}),
      status: row.status,
      statementDate: row.statement_date,
      ...(row.closing_balance !== null ? { closingBalance: row.closing_balance } : {}),
      ...(row.total_due !== null ? { totalDue: row.total_due } : {}),
    }))

    const { drafts, suppressedTenantIds } = arrearsFindings({ statements, arrangements, settings, names, asOf })
    const result = await new MonitoringOutputs(db, companyId).raise(drafts)
    this.logger.log(
      { companyId, asOf, findings: drafts.length, suppressed: suppressedTenantIds.length, ...result },
      'Arrears monitoring complete',
    )
    return { findings: drafts.length, suppressed: suppressedTenantIds.length, ...result }
  }
}
